'use strict';

// IMPORTANT: use UTC timezone so the comparison logic is guarenteed to work
process.env.TZ = 'UTC';


const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const queryClient = new AWS.TimestreamQuery();

const redis = require('redis');

const secret = require('../secret').secret;
const constants = require('../constants').constants;

const tps_query = `
(SELECT name, id, type, 
    CREATE_TIME_SERIES(time, measure_value::double) AS tps
   FROM "${constants.DATABASE_NAME}"."${constants.TABLE_NAME}" 
   WHERE measure_name = 'tps' AND time > ago(14D)
   GROUP BY name, id, type)
`

const player_query = `
SELECT name, id, type, 
 CREATE_TIME_SERIES(time, measure_value::bigint) as players
FROM "${constants.DATABASE_NAME}"."${constants.TABLE_NAME}" 
WHERE measure_name = 'players' AND time > ago(14D)
GROUP BY name, id, type
`

const online_query_1 = `
SELECT name, id, type, 
 CREATE_TIME_SERIES(time, measure_value::boolean) as online
FROM "${constants.DATABASE_NAME}"."${constants.TABLE_NAME}" 
WHERE measure_name = 'online' AND time BETWEEN ago(60D) and ago(40D)
GROUP BY name, id, type
`

const online_query_2 = `
SELECT name, id, type, 
 CREATE_TIME_SERIES(time, measure_value::boolean) as online
FROM "${constants.DATABASE_NAME}"."${constants.TABLE_NAME}" 
WHERE measure_name = 'online' AND time BETWEEN ago(40D) and ago(20D)
GROUP BY name, id, type
`

const online_query_3 = `
SELECT name, id, type, 
 CREATE_TIME_SERIES(time, measure_value::boolean) as online
FROM "${constants.DATABASE_NAME}"."${constants.TABLE_NAME}" 
WHERE measure_name = 'online' AND time BETWEEN ago(20D) and now()
GROUP BY name, id, type
`

module.exports.history = async (event, context) => {

    const client = redis.createClient({
        socket: {
            host: secret.redis.host,
            port: secret.redis.port,
        },
        password: secret.redis.password,
    });

    await client.connect();

    let history = await client.get('history.cache');
    if(history !== null) {
        await client.quit();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: history
        };    
    } else {
        history = {};
        history.servers = JSON.parse(await client.get('status.cache'));
    }
    history.servers.cached = undefined;
    history.servers.cached_timestamp = undefined;

    let tps_rows = [];
    let player_rows = [];
    let online_rows_1 = [];
    let online_rows_2 = [];
    let online_rows_3 = [];


    // run all three queries in parallel
    await Promise.all([
        getAllRows(tps_query, null, tps_rows),
        getAllRows(player_query, null, player_rows),
        getAllRows(online_query_1, null, online_rows_1),
        getAllRows(online_query_2, null, online_rows_2),
        getAllRows(online_query_3, null, online_rows_3)
    ]);

    // add history object
    for (const [key, value] of Object.entries(history.servers)) {
        if(key !== 'cached' && key !== 'cached_timestamp') {
            history.servers[key].history = {};
        }
    }

    for(const tps_row of tps_rows) {
        if(history.servers[tps_row.name]) {
            history.servers[tps_row.name].history.tps = tps_row.tps;
        }
    }

    for(const player_row of player_rows) {
        if(history.servers[player_row.name]) {
            history.servers[player_row.name].history.players = player_row.players;
        }
    }

    // filter player and tps data for each server
    for (const [key, value] of Object.entries(history.servers)) {
        if(key !== 'cached' && key !== 'cached_timestamp') {
            if(history.servers[key].history.tps) {
                filter_history(history.servers[key].history.tps);
            }
            if(history.servers[key].history.players) {
                filter_history(history.servers[key].history.players);
            }
        }
    }

    // console.log(online_rows);

    for(const online_row of online_rows_1) {
        if(history.servers[online_row.name]) {

            // merge with the online timeseries of the second and third query
            for(const online_row_2 of online_rows_2) {
                if(online_row_2.name === online_row.name) {
                    online_row.online = online_row.online.concat(online_row_2.online);
                }
            }
            for(const online_row_3 of online_rows_3) {
                if(online_row_3.name === online_row.name) {
                    online_row.online = online_row.online.concat(online_row_3.online);
                }
            }

            history.servers[online_row.name].history.online = get_offline_times(online_row.online);
        }
    }

    // set caching metadata for redis
    history.cached = true;
    history.cached_timestamp = new Date().getTime();

    await client.set('history.cache', JSON.stringify(history), {
        EX: constants.HISTORY_CACHE_TIMEOUT
    });


    // don't waste Redis connections!
    await client.quit();

    // because this response is not cached
    history.cached = false;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(history)
    };

};

function filter_history(data) {
    let i = 1

    // remove repeating elements, but always keep the last element
    while (i < data.length - 1) {
        if(data[i-1].value === data[i].value) {
            data.splice(i, 1);
        } else {
            i += 1;
        }
    }

    // change timezones to ms since epoch so the browser can use its local timezone
    data.map(e => {
        e.time = new Date(e.time).getTime();
    });
}

function get_offline_times(online_result) {
    // start at 58 days ago, work to -1 days ago (-1 represents the current day)
    let days_ago = 58

    // store the state of the server
    let offline_start = null;
    let i = 0;
    let offline_times = [];

    while(i < online_result.length) {

        let offline_time = 0;

        // while the datapoint is before the number of days ago ( 1 day = 86400000 ms )
        while(i < online_result.length && new Date(online_result[i].time).getTime() <= new Date().setHours(0, 0, 0, 0) - days_ago*86400000) {

            const online_result_time = new Date(online_result[i].time).getTime();

            // if the server is offline but the last value says online, start a new offline time
            if(offline_start === null && online_result[i].value === false) {
                offline_start = online_result_time;
            }

            // if the server is online but the last value says offline, end the offline time and add it
            if(offline_start !== null && online_result[i].value === true) {
                // track the offline time
                offline_time += online_result_time - offline_start;

                // reset the offline status
                offline_start = null;
            }
            i += 1;
        }

        // if the server is offline at the end of the day, add the rest of the day to the online time
        // and change the offline start time to the beginning of the next day
        if(offline_start !== null) {
            // use min to account for the edge case at the end of the last day, which might be in the future
            const next_day_starts = Math.min(new Date().getTime(), new Date().setHours(0, 0, 0, 0) - days_ago*86400000);

            offline_time += next_day_starts - offline_start;
            offline_start = next_day_starts;
        }
        // console.log(`Days ago: ${days_ago}`);

        // console.log(`Starts before: ${new Date(new Date().setHours(0, 0, 0, 0) - days_ago*86400000).toLocaleString()}`)

        // console.log(`Offline time: ${offline_time}`);
        offline_times.push(offline_time);
        days_ago -= 1;
    }

    return offline_times;

}

async function getAllRows(query, nextToken, allRows) {
    const params = {
        QueryString: query
    };

    // if (nextToken) {
    //     params.NextToken = nextToken;
    // }

    let response = await queryClient.query(params).promise();
    parseQueryResult(response, allRows);
    // console.log(`${JSON.stringify(response)}`);

    while(response.NextToken) {
        params.NextToken = response.NextToken;
        response = await queryClient.query(params).promise();
        parseQueryResult(response, allRows);
        // console.log(`${JSON.stringify(response)}`);
    }

}


function parseQueryResult(response, allRows) {
    const queryStatus = response.QueryStatus;
    // console.log("Current query status: " + JSON.stringify(queryStatus));
    
    const columnInfo = response.ColumnInfo;
    const rows = response.Rows;

    // console.log("Metadata: " + JSON.stringify(columnInfo));
    // console.log("Data: ");

    rows.forEach(function (row) {
        // console.log(parseRow(columnInfo, row));
        // console.log(`Row: ${row}, allRows: ${allRows}`);
        allRows.push(parseRow(columnInfo, row));
    });
}

function parseRow(columnInfo, row) {
    const data = row.Data;
    const rowOutput = {};

    var i;
    for ( i = 0; i < data.length; i++ ) {
        const info = columnInfo[i];
        const datum = data[i];
        rowOutput[info.Name] = parseDatum(info, datum);
    }

    return rowOutput;
}

function parseDatum(info, datum) {
    if (datum.NullValue != null && datum.NullValue === true) {
        let retVal = {}
        retVal[info.Name] = 'null';
        return retVal;
    }

    const columnType = info.Type;

    // If the column is of TimeSeries Type
    if (columnType.TimeSeriesMeasureValueColumnInfo != null) {
        return parseTimeSeries(info, datum);
    }
    // If the column is of Array Type
    else if (columnType.ArrayColumnInfo != null) {
        const arrayValues = datum.ArrayValue;
        let retVal = {}
        retVal[info.Name] = parseArray(info.Type.ArrayColumnInfo, arrayValues);
        return retVal;
    }
    // If the column is of Row Type
    else if (columnType.RowColumnInfo != null) {
        const rowColumnInfo = info.Type.RowColumnInfo;
        const rowValues = datum.RowValue;
        return parseRow(rowColumnInfo, rowValues);
    }
    // If the column is of Scalar Type
    else {
        return parseScalarType(info, datum);
    }
}

function parseTimeSeries(info, datum) {
    const timeSeriesOutput = [];
    datum.TimeSeriesValue.forEach(function (dataPoint) {
        // timeSeriesOutput.push(`{time=${dataPoint.Time}, value=${parseDatum(info.Type.TimeSeriesMeasureValueColumnInfo, dataPoint.Value)}}`)
        timeSeriesOutput.push({
            time: dataPoint.Time,
            value: parseDatum(info.Type.TimeSeriesMeasureValueColumnInfo, dataPoint.Value)
        })
    });

    // return `[${timeSeriesOutput.join(", ")}]`
    return timeSeriesOutput;
}

function parseScalarType(info, datum) {
    // let retVal = {};
    // retVal[parseColumnName(info)] = datum.ScalarValue;

    // console.log(`parseScalarType info: ${ JSON.stringify(info)}`);

    if(info?.Type?.ScalarType === 'DOUBLE') {
        return parseFloat(datum.ScalarValue);
    }

    if(info?.Type?.ScalarType === 'BIGINT') {
        return parseInt(datum.ScalarValue);
    }

    if(info?.Type?.ScalarType === 'BOOLEAN') {
        return datum.ScalarValue === 'true';
    }

    return datum.ScalarValue;
}

function parseColumnName(info) {
    return info.Name == null ? "NULL" : `${info.Name}`;
}

function parseArray(arrayColumnInfo, arrayValues) {
    const arrayOutput = [];
    arrayValues.forEach(function (datum) {
        arrayOutput.push(parseDatum(arrayColumnInfo, datum));
    });
    return arrayOutput;
    // return `[${arrayOutput.join(", ")}]`
}
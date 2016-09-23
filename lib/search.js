// non documented function. Worry about that some other day. It won't go away soon because nodejs relies on it!
var extend = require('util')._extend;

var FileRecordUtil = require('./file-record');

var method = Search.prototype;

var SLASH = '/';

function Search(config, snc) {
    this.config = config;
    this.snc = snc;
    this.logger = config._logger;
}

/*
 * If a subDirPattern is defined (in config) then return a directory path
 * that is composed of defined strings and attribute values found on the record
 */
function getSubDirs(subDirPattern, record) {
    var subDirs = '',
        pathSplit = SLASH,
        recordAttributes = /(<[a-z_]*>)/gi; // eg. "active_<active_field>".match(recordAttributes)

    if (subDirPattern && subDirPattern !== '') {
        var subDirParts = subDirPattern.split(pathSplit),
            subFolders = [];
        for (var j = 0; j < subDirParts.length; j++) {
            var subPart = subDirParts[j],
                field = subPart,
                prefix = '';

            // this is a mixed pattern like "active_<active>/type" so we need to evaluate the tags
            if (subPart.indexOf('<') >= 0) {
                var regExParts = subPart.match(recordAttributes);

                // todo, support multiple regex matches in one subdir path.
                // eg. "active_<active_field>_type_<type>".match(recordAttributes) gives ["<active_field>", "<type>"]

                field = regExParts[0].replace('<', '').replace('>', '');
                prefix = subPart.replace(regExParts[0], '');
                //console.log('prefix : field: ' + prefix + ' : ' + field);
            }

            if (record[field]) {
                subFolders.push(prefix + record[field]);
            }
        }
        subDirs = subFolders.join(pathSplit);
    }
    return subDirs;
}

method.getResults = function (queryObj, callback) {
    var logger = this.logger,
        snc = this.snc,
        config = this.config,
        recordsFound = {},
        folObj,
        callCount = 0,
        _this = this,
        db = {
            table: queryObj.table || '',
            query: queryObj.query || '',
            rows: queryObj.rows || 5 // default
        };


    if (queryObj.demo) {
        logger.info('- - - - Running in Demo mode - - - -'.yellow);
        db.table = 'sys_script';
        db.query = 'sys_updated_by' + '=' + 'admin' + '^ORDERBYDESC' + 'sys_updated_on';
        queryObj.table = db.table;
        logger.info('Using search options: ', db);
    }


    function receivedRecords(records) {
        callCount--;
        // only callback once all queries have completed
        if (callCount <= 0) {
            logger.info('Total records found: %s'.green, records.length);
            logger.info('(max records returned per search set to %s)', db.rows);
            callback(_this, queryObj, recordsFound);
        }
    }

    // for each folder and field in folder query for records
    // (handles searching only one table as well if set)
    for (var folder in config.folders) {

        folObj = config.folders[folder];

        // Check if we're only looking for one table
        if (queryObj.table && folObj.table != db.table) {
            continue;
        }

        db.key = folObj.key;
        db.folder = folder;
        db.table = folObj.table;
        db.subDir = folObj.subDirPattern || false;
        // fields are optional
        db.fields = queryObj.recordOnly ? false : folObj.fields;

        callCount++;
        getRecords(db, receivedRecords);
    }

    if (queryObj.table && callCount === 0) {
        logger.warn('No table config defined for: %s', queryObj.table);
    }

    function getRecords(db, cb) {
        //logger.debug('args:', arguments);

        // we have a problem with objects "passed by reference" and so we make a local var here
        var loc = {},
            locDB = extend(loc, db);

        snc.table(locDB.table).getRecords(locDB, function (err, obj) {
            if (err) {
                logger.info('ERROR in query or response.'.red);
                logger.info(err);
                cb([]);
                return;
            }
            if (obj.records.length === 0) {
                logger.info('No records found on %s:'.yellow, locDB.table);
                cb([]);
                return;
            }

            var recordIndex;
            for (recordIndex in obj.records) {
                var record = obj.records[recordIndex],
                    recordName = record[locDB.key],
                    sys_id = record.sys_id,
                    recordData,
                    recordKey;


                logger.debug('Record Found: "' + recordName + '"');
                logger.debug('- Created on ' + record.sys_created_on);
                logger.debug('- Updated by ' + record.sys_updated_by + ' on ' + record.sys_updated_on);


                // TODO : looks broken because locDB.fieldSuffix is undefined???
                var isSCSSRecord = FileRecordUtil.isSCSS(recordName);
                // check that it is really a SCSS file and not a CSS file!
                if (locDB.fieldSuffix == 'scss' && !isSCSSRecord) {
                    continue; // skip, not applicable for this folder
                }
                if (locDB.fieldSuffix == 'css' && isSCSSRecord) {
                    continue; // skip, not applicable for this folder
                }

                var subDirs = getSubDirs(locDB.subDir, record);

                // fields are optional
                if (locDB.fields) {
                    // populate our data object based on each mapped field for this table
                    for (var fieldInList in locDB.fields) {
                        var field = locDB.fields[fieldInList],
                            fieldSuffix = fieldInList;

                        // allow only returning specific fields
                        if(queryObj.restrictFields && queryObj.restrictFields.indexOf(field) == -1) {
                            continue;
                        }

                        recordKey = sys_id + field;
                        recordData = record[field];

                        recordsFound[recordKey] = {
                            recordName: recordName,
                            recordData: recordData,
                            table: locDB.table,
                            folder: locDB.folder,
                            field: field,
                            fieldSuffix: fieldSuffix,
                            subDir: subDirs
                        };

                        var additionalProps = ['sys_id', 'sys_updated_on', 'sys_updated_by'];
                        for (var i = 0; i < additionalProps.length; i++) {
                            var key = additionalProps[i];
                            recordsFound[recordKey][key] = record[key];
                        }
                    }
                }

                if (queryObj.fullRecord) {
                    recordsFound[sys_id] = {
                        table: locDB.table,
                        folder: locDB.folder,
                        recordName: recordName,
                        recordData: record,
                        fullRecord: true,
                        subDir: subDirs,
                        fieldSuffix: 'record.json'
                    };
                }
            }

            var recordCount = recordIndex * 1 + 1;
            logger.info('Found %s record%s for %s'.green, recordCount, recordCount > 1 ? 's' : '', locDB.table);

            cb(obj.records);

        });
    }

};

module.exports = {
    Search: Search
};

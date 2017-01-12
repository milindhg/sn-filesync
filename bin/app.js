#!/usr/bin/env node

// ---------------------------------------------------
// 3rd party modules

var argv = require('minimist')(process.argv.slice(2));
//console.dir(argv);

var chokidar = require('chokidar');
require('colors');
var fs = require('fs-extra');
var path = require('path');
// used to generate a hash of a file
var crypto = require('crypto');
var glob = require("glob");
var winston = require('winston');
var moment = require('moment');

// ---------------------------------------------------
// custom imports
var configLoader = require('../lib/config'),
    config = {},
    upgradeNeeded = require('../lib/upgrade'),
    sncClient = require('../lib/snc-client'),
    notify = require('../lib/notify'),
    SearchUtil = require('../lib/search'),
    Search = SearchUtil.Search,
    runTests = require('../lib/tests'),
    FileRecordUtil = require('../lib/file-record'),
    FileRecord = FileRecordUtil.FileRecord,
    makeHash = FileRecordUtil.makeHash;

// our wrapper for winston used for logging
var logit = {};

// custom vars
var notifyObj = notify();
var notifyUserMsg = notifyObj.msg,
    notifyEnabled = true,
    // list of supported notification messages defined in notify.js
    msgCodes = notifyObj.codes;

var DOWNLOAD_OK = 1,
    DOWNLOAD_FAIL = -1,
    multiDownloadStatus = DOWNLOAD_OK,
    SLASH = '/';


var isMac = /^darwin/.test(process.platform);
//var isWin = /^win/.test(process.platform);

var testsRunning = false;

var chokiWatcher = false,
    chokiWatcherReady = false,
    // ignore hidden files/dirs like .sync_data when watching for changes
    chokiWatcherIgnore = /[\/\\]\./; // NOTE: anymatch (micromatch for globs) no longer works with ["**/.*"]

var filesInQueueToDownload = 0,
    filesToPreLoad = {};

// a list of FileRecord objects indexed by file path for easy access
var fileRecords = {};

// set to true to exit after a download is complete (avoids watcher starting)
var endApp = false;

// ---------------------------------------------------

// entry point
function init() {

    if (argv.help) {
        displayHelp();
        process.exit(1);
        return;
    }

    // get config
    try {
        if (!argv.config) {
            console.log('The config argument must be specified (eg. --config app.config.json)'.red);
            console.log('Run with --help for more info');
            process.exit(1);
        }
        configLoader.setConfigLocation(argv.config);
        config = configLoader.getConfig();
    } catch (e) {
        winston.error('Configuration error:'.red, e.message);
        process.exit(1);
    }

    //config.debug = true;
    setupLogging();

    if (config.debug) {
        notifyObj.setDebug();
    }

    // Apply custom file watcher ignore rules
    if (config.ignoreFiles) {
        chokiWatcherIgnore = config.ignoreFiles;
    }

    function start(upgradeBlocks) {
        if (upgradeBlocks) {
            logit.error('Upgrade is needed. Please check the Readme and change logs online.'.red);
            process.exit(1);
        }


        if (argv.test) {
            logit.info('TEST MODE ACTIVATED'.green);
            testsRunning = true;
            runTests({
                addFile: addFile,
                getSncClient: getSncClient,
                readFile: readFile,
                writeFile: writeFile,
                send: send,
                push: push,
                trackFile: trackFile
            }, config);
            return;
        }

        if (argv.export) {
            if (argv.export === true || argv.export.length < 4) {
                logit.error('Please specify a proper export location.');
                logit.error('Eg. --export ~/Desktop/config.json');
                process.exit(1);
            }
            exportCurrentSetup(argv.export);
            return;
        }

        if (config.createAllFolders || argv.setup) {
            setupFolders(config, function () {
                logit.info('Created folders required for syncing records'.green);
            });
        }
        // pre add some files defined per root in config
        if (config.preLoad) {
            addConfigFiles();
        }

        // allow direct pushing of a specific file/field to the instance (provided it's already synced)
        if (argv.push) {
            pushUpRecord(argv);
            return;
        }

        // allow direct downloading of a file/field
        if (argv.pull) {
            pullDownRecord(argv);
            return;
        }

        // allow searching for records
        if (argv.search) {
            startSearch(argv);
            return;
        }

        // callback dependency
        if (argv.resync || config._resyncFiles) {
            // retest this!
            config._resyncFiles = true;
            resyncExistingFiles();
        }

        initComplete();
    }

    function initComplete() {
        if (filesInQueueToDownload !== 0) {
            // if files are being downloaded then the watcher will be started when
            // the download queue is cleared. Assumes all downloads complete before user
            // needs to download new files.
            return;
        }
        logit.log('initComplete.. starting watcher..');
        watchFolders();
    }

    upgradeNeeded(config, start);
}

function getFolderConfig(folderName) {
    for (var f in config.folders) {
        var folder = config.folders[f];
        if (f == folderName) {
            return folder;
        }
    }
    return false;
}

function extractSysIdFromName(str) {
    var regEx = new RegExp("[a-z0-9]{32,}", "gi"),
        matches;
    if (typeof str != 'string') {
        return false;
    }

    matches = str.match(regEx);

    if (matches && matches.length > 0) {
        // assumes only one sys_id str
        return matches[0];
    }

    return false;
}


function getFirstRoot() {
    var roots = config.roots,
        keys = Object.keys(roots),
        firstRoot = keys[0];
    return firstRoot;
}

function updateFileMeta(file, record) {
    fileRecords[file].updateMeta({
        sys_id: record.sys_id,
        sys_updated_on: record.sys_updated_on,
        sys_updated_by: record.sys_updated_by
    });
}


/**
 * Remove problematic characters for saving to a file
 * @param pathPart {string} - a folder or file name (not full path) to normalise
 * @return {string} - updated path
 */
function normaliseRecordName(pathPart) {
    var newName = pathPart;
	if (!((newName == null) || (typeof newName == 'undefined') || ('' == '' + newName))){
		newName = newName.replace(/\//g, '_');
		newName = newName.replace(/\*/g, '_');
		newName = newName.replace(/\\/g, '_');
	}
    return newName;
}

function pushUpRecord(argv) {
    /*
     * Supported test cases:
     *
     * --push "ui_pages/attachment.xhtml"
     *
     */

    var sys_id = extractSysIdFromName(argv.pull);
    sys_id = false; // TODO: not yet supported
    if (sys_id) {
        // TODO: find the file that uses this sys_id (by using the .sync_data files)
    } else {

        // do we have a valid file path?
        argv.push = FileRecordUtil.normalisePath(argv.push);
        if (argv.push.indexOf(SLASH) > 0) {
            var parts = argv.push.split(SLASH),
                folder = parts[0],
                file = parts[parts.length - 1],
                filePath = getFirstRoot() + SLASH + argv.push;

            logit.info('Will process file "%s" in folder "%s" with push path: %s', file, folder, filePath);

            var f = trackFile(filePath);
            if (!f) {
                logit.error('Path not valid: %s', filePath);
            } else {
                send(filePath, function (complete) {
                    if (!complete) {
                        logit.error(('Could not push file (not found): ' + filePath).red);
                    }
                });
            }
        }
    }
}

/**
 * Uses the search tool to pull down records based on options provided
 * @param argv {object} - options for finding record
 */
function pullDownRecord(argv) {
    /*
     * Supported test cases:
     *
     * --pull "ui_pages/attachment.xhtml"
     * --pull "ui_pages/attachment"
     *
     * --table rm_story --pull "Block invalid group data from being used_a4e79eab3746d200b67a13b853990e87.txt"
     *
     * --table rm_story --pull "a4e79eab3746d200b67a13b853990e87"
     * --table sys_script_include --pull "56c8741f0a0a0b34003ec298a82ea737"
     * --table sys_ui_page --pull "b1b390890a0a0b1e00f6ae8a31ee2697"
     *
     * --table rm_story --pull --search_query "short_description=Block invalid group data from being used"
     * --table sys_script_include --pull --search_query "name=ActionUtils"
     * --table sys_ui_page --pull --search_query "name=attachment"
     */

    // pull = via seach query if set
    var query = argv.search_query || '';
    var sys_id = extractSysIdFromName(argv.pull);
    var restrictFields = [];
    var parts, folder, file, pullPath, folderObj = false;
    // was a path value provided to --pull ?
    var isPath = argv.pull !== true;

    if (isPath) {
        argv.pull = FileRecordUtil.normalisePath(argv.pull);
        // make sure there is a real path provided
        isPath = argv.pull.indexOf(SLASH) > 0;
    }

    if (isPath) {
        parts = argv.pull.split(SLASH);
        folder = parts[0];
        file = parts[parts.length - 1];
        pullPath = getFirstRoot() + SLASH + argv.pull;
        folderObj = getFolderConfig(folder);
    }

    if (sys_id) {
        // pull = record from sys_id
        query = 'sys_id=' + sys_id;
        if (folderObj) {
            argv.table = folderObj.table;
        }
    } else if (isPath) {
        // pull = path to file (first path component must be folder, last is record identifier with optional suffix)

        if (!folderObj) {
            logit.error('Could not find the mapping for this file: %s', argv.pull);
            process.exit(0);
            return;
        }

        argv.table = folderObj.table;

        logit.info('Processing file "%s" in folder "%s" on table "%s".', file, folder, argv.table);

        var f = trackFile(pullPath);
        if (f) {
            // use map to get specific field
            var map = f.getSyncMap();
            query = folderObj.key + '=' + map.fileName;
            restrictFields.push(map.field);
        } else {
            // try searching for the file to download
            query = folderObj.key + '=' + file;
        }

    }

    if (query === '') {
        // a pull without a query makes no sense.
        logit.error('No valid pull query specified.');
        process.exit(0);
        return;
    }

    startSearch({
        search_query: query,
        search_table: argv.table || '',
        download: true,
        records_per_search: 1,
        full_record: argv.full_record || false,
        record_only: argv.record_only || false,
        pull: argv.pull,
        fields: restrictFields.length > 0 ? restrictFields : false
    });
}

function startSearch(argv) {

    var queryObj = {
        query: argv.search_query || '',
        table: argv.search_table || '',
        download: argv.download || false,
        rows: argv.records_per_search || false,
        fullRecord: argv.full_record || false,
        recordOnly: argv.record_only || false,
        restrictFields: argv.fields || false
    };

    // is the search already defined in the config file?
    var definedSearch = argv.search && argv.search.length > 0 && config.search[argv.search];

    // support search via config file
    if (definedSearch) {
        var searchObj = config.search[argv.search];
        // what is specified in config file overrides cmd line options
        // this encourages re-usable config and reduces human error with the cmd line
        queryObj.query = searchObj.query || queryObj.query;
        queryObj.table = searchObj.table || queryObj.table;
        queryObj.download = searchObj.download || queryObj.download;
        queryObj.rows = searchObj.records_per_search || queryObj.rows;
        queryObj.fullRecord = searchObj.full_record || queryObj.fullRecord;
        queryObj.recordOnly = searchObj.record_only || queryObj.recordOnly;

        if (queryObj.recordOnly) {
            // implied logic
            queryObj.fullRecord = true;
        }
    } else if (argv.pull || argv.push) {
        // these are specifc pull and push requests
    } else {
        logit.info('Note: demo mode active as no defined search in your config file was found/specified.'.yellow);
        queryObj.demo = true;
    }


    logit.info('Performing search'.green);
    logit.info(queryObj);

    logit.info("Note: only the first root defined is supported for searching.\n".yellow);
    var firstRoot = getFirstRoot(),
        snc = getSncClient(firstRoot); // support first root for now

    var s = new Search(config, snc);
    s.getResults(queryObj, processFoundRecords);
}

/**
 * Callback from after the Search.getResults() call is complete
 *
 * @param searchObj {object} - the search module itself
 * @param queryObj {object} - the input provided to search on
 * @param records {object} - list of fields and complete records to process
 */
function processFoundRecords(searchObj, queryObj, records) {
    var firstRoot = getFirstRoot(),
        basePath = config.roots[firstRoot].root,
        totalFilesToSave = 0,
        totalErrors = 0,
        totalSaves = 0,
        failedFiles = [];

    // process found records
    for (var i in records) {
        var record = records[i],
            validData,
            validResponse = ((typeof record.recordData != 'undefined') && !((record.recordName == null) || (typeof record.recordName == 'undefined') || ('' == '' + record.recordName))),
            fileSystemSafeName = normaliseRecordName(record.recordName),
            filePath = basePath + SLASH + record.folder + SLASH,
            suffix = record.fieldSuffix,
            sys_id = '';

        if (validResponse) {
            sys_id = record.recordData.sys_id || record.sys_id;
        } else {
            var bestGuessName = filePath + ' .... ' + fileSystemSafeName;
            // seems like protected records that are read-only hide certain fields from view
            logit.warn('Found but will ignore to protected record: ' + bestGuessName);
            totalErrors++;
            failedFiles.push(bestGuessName);
            continue;
        }

        if (config.ensureUniqueNames) {
            suffix = sys_id + '.' + suffix;
        }

        var fileName = fileSystemSafeName + '.' + suffix;

        if (record.subDir !== '') {
            filePath += record.subDir + SLASH;
        }
        filePath += fileName;

        // ensure we have a valid file name
        if (fileSystemSafeName.length === 0) {
            totalErrors++;
            failedFiles.push(filePath);
            continue;
        }

        validData = record.recordData.length > 0 || record.recordData.sys_id;
        if (validData) {
            logit.info('File to create: ' + filePath);
        } else {
            logit.info('Found but will ignore due to no content: ' + filePath);
            totalErrors++;
            failedFiles.push(filePath);
        }

        if (queryObj.download) {
            // don't save files of 0 bytes as this will confuse everyone
            if (validData) {
                totalFilesToSave++;
                saveFoundFile(filePath, record);
            }
        }
    }
    if (!queryObj.download) {
        if (totalErrors > 0) {
            logit.warn("Finished searching for files. %s file(s) will not be saved: \n%s", totalErrors, failedFiles.join("\n"));
        }
        process.exit(1);
    }


    function outputFile(file, data) {
        fs.outputFile(file, data, function (err) {

            totalFilesToSave--;
            if (err) {
                logit.error('Failed to write out file %s', file);
                totalErrors++;
                failedFiles.push(file);
            } else {
                logit.info('Saved file %s', file);
                totalSaves++;
            }

            // done writing out files.
            if (totalFilesToSave <= 0) {
                doneSaving();
            }
        });

    }

    // save both the sync hash file and record as file.
    function saveFoundFile(file, record) {

        var data = record.recordData;

        if (record.fullRecord) {
            data = JSON.stringify(data, null, 4);
            outputFile(file, data);

        } else {

            if (!trackFile(file)) {
                logit.error('File (path) is not valid %s', file);
                totalFilesToSave--;
                totalErrors++;
                failedFiles.push(file);
                return;
            }

            updateFileMeta(file, record);

            fileRecords[file].saveHash(data, function (saved) {
                if (!saved) {
                    logit.error('Failed to write out sync data file for %s', file);
                    totalFilesToSave--;
                    totalErrors++;
                    failedFiles.push(file);
                } else {
                    // no issues writing sync file so write out record to file
                    outputFile(file, data);
                }
            });
        }
    }

    function doneSaving() {
        if (totalErrors > 0) {
            logit.warn("Finished creating %d files with errors. %s file(s) failed to save, had 0 bytes as content or would be invisible (eg. \".some-file.js\"): \n%s",
                totalSaves, totalErrors, failedFiles.join("\n"));
        } else {
            logit.info('Finished creating %d files.', totalSaves);
        }
        process.exit(1);
    }
}

/*
 * Get a list of all the files and add it to "filesToPreLoad"
 */
function resyncExistingFiles() {
    var watchedFolders = Object.keys(config.roots);
    var roots = [];
    for (var i = 0; i < watchedFolders.length; i++) {
        // match all files in all directories (excludes .hidden dirs by default)
        roots.push(watchedFolders[i] + '/**/*');
    }
    var pattern = roots.join('');
    // can be multiple sets
    if (roots.length > 1) {
        pattern = '{' + roots.join(',') + '}';
    }

    glob(pattern, {
        nodir: true
    }, function (err, files) {
        if (err) logit.error('Exception:', err);

        if (files.length === 0) {
            logit.info('No files found to resync'.red);
            watchFolders();
        }

        // files is an array of filenames.
        for (var x in files) {
            //logit.info(('Adding file: '+files[x]).blueBG);
            addToPreLoadList(files[x], {
                filePath: files[x]
            });
        }
    });
}


function notifyUser(code, args) {
    // depending on the notification system, we could flood the OS and get blocked by security
    //   Eg. too many open files via terminal-notifier-pass.app launches)
    if (notifyEnabled) {
        notifyUserMsg(code, args);
    }
}

function addConfigFiles() {
    var filesToGet = 0;
    // each root
    for (var r in config.roots) {
        var basePath = r,
            root = config.roots[r];
        if (root.preLoadList) {
            // each folder (assume typed correctly)
            for (var folder in root.preLoadList) {
                // each file to create
                for (var file in root.preLoadList[folder]) {
                    var filePath = path.join(r, folder, root.preLoadList[folder][file]);
                    addToPreLoadList(filePath, {
                        filePath: filePath
                    });
                    filesToGet++;
                }
            }
        }
    }
    logit.log(('Downloading ' + filesToGet + ' files...').green + '(disable this by setting preLoad to false in your config file.)');
}

function addToPreLoadList(filePath, options) {
    options = options || {
        filePath: filePath
    };
    // only process if we don't already have it in the list
    if (typeof filesToPreLoad[filePath] == 'undefined') {
        filesToPreLoad[filePath] = options;
        addFile(filePath);
    }
}

function addIfNotPresent(filePath) {
    fs.exists(filePath, function (exists) {
        if (!exists) {
            addFile(filePath);
        }
    });
}


function displayHelp() {
    var msgs = ['--help                   :: shows this message',
                '--config <file>          :: specify a path to your app.config.json file',
                '--setup                  :: will create your folders for you',
                '--test                   :: will self test the tool and connection',
                '--resync                 :: will re-download all the files to get the latest server version',
                '--export <file>          :: export the current setup including downloaded records for quickstart',
                '--search <search config> :: will run a search on the instance for matching records based on the ' +
                                            'defined search config in the app.config.json file',
                '--download               :: applies to searching and will download the found records'

               ];
    console.log('Help'.green);
    console.log('List of options:');
    for (var i in msgs) {
        console.log(' ' + msgs[i]);
    }
}

function handleError(err, context) {
    logit.error(err);
    if (context) {
        logit.error('  handleError context:', context);
    }
}

function getSncClient(root) {
    var host = config.roots[root];
    if (!host._client) {
        host._logger = logit;
        host.debug = config.debug;
        host.proxy = config.proxy || null;
        host._client = new sncClient(host);
    }
    return host._client;
}

/*
 * Copy the current config file in use and output a version without
 * sensitive data but with the preLoadList filled in as per the
 * current list of downloaded records.
 * */
function exportCurrentSetup(exportConfigPath) {

    logit.info('Creating new config file...');
    var exportConfig = {
        "roots": config.roots,
        "search": config.search,
        "folders": configLoader.getCustomFolders(config),
        "preLoad": true,
        "createAllFolders": true
    };

    var watchedFolders = Object.keys(config.roots);

    for (var i in watchedFolders) {
        // remove sensitive data that may exist
        delete exportConfig.roots[watchedFolders[i]].auth;
        // overwrite remaining sensitive data
        exportConfig.roots[watchedFolders[i]].user = '<your user name>';
        exportConfig.roots[watchedFolders[i]].pass = '<your password (which will be encrypted)>';

        exportConfig.roots[watchedFolders[i]].preLoadList = {};
    }

    var chokiWatcher = chokidar.watch(watchedFolders, {
            persistent: true,
            // ignores use anymatch (https://github.com/es128/anymatch)
            ignored: chokiWatcherIgnore
        })
        .on('add', function (file, stats) {
            // add all files that have content..
            //  files without content will confuse the person starting
            //  and could be considered irrelevant.
            if (stats.size > 0) {
                logit.info('File to export: %s', file);
                var f = new FileRecord(config, file),
                    folder = f.getFolderName(),
                    fileName = f.getFileName(),
                    rootDir = f.getRoot();

                // add to appropriate preLoadList folder array
                if (!exportConfig.roots[rootDir].preLoadList[folder]) {
                    exportConfig.roots[rootDir].preLoadList[folder] = [];
                }
                exportConfig.roots[rootDir].preLoadList[folder].push(fileName);
            }
        })
        .on('ready', function () {
            logit.debug('Exporting config: %j', exportConfig);

            fs.writeFile(exportConfigPath, JSON.stringify(exportConfig, null, 4), function (err) {
                if (err) {
                    logit.eror('Error updating/writing config file. path: %s', exportConfigPath);
                } else {
                    logit.info('Export complete'.green);
                    logit.info('Export location: %s'.green, exportConfigPath);
                }
                process.exit(1);
            });

        });
}

/* keep track of files waiting to be processed
 * and disable watching files to avoid double processing
 */
function queuedFile() {
    if (chokiWatcher) {
        //logit.info('*********** Killed watch *********** '.green);
        chokiWatcher.close();
        chokiWatcher = false;
    }
    filesInQueueToDownload++;
    logit.info(('Files left in queue: ' + filesInQueueToDownload).redBG);

    // more than 2 files in the queue? Lets disable notify to avoid the ulimit issue
    if (filesInQueueToDownload > 2 && notifyEnabled) {
        notifyEnabled = false;
        // reset multi file download status to OK.
        multiDownloadStatus = DOWNLOAD_OK;
    }
}

/*
 * When done processing a file consider if we can re-enable
 * notifications and watching for changed files.
 */
function decrementQueue() {
    filesInQueueToDownload--;
    logit.info(('Files left in queue: ' + filesInQueueToDownload).blueBG);
    if (filesInQueueToDownload === 0) {

        // re-enable notifications (notifications only disabled when multiple files in queue)
        if (!notifyEnabled) {
            notifyEnabled = true;
            // show one notification to represent if all files were downloaded or not
            if (multiDownloadStatus == DOWNLOAD_FAIL) {
                logit.error('Some or all files failed to download'.red);
                notifyUser(msgCodes.COMPLEX_ERROR);
            } else {
                notifyUser(msgCodes.ALL_DOWNLOADS_COMPLETE);
            }
        }

        if (endApp) {
            process.exit(1);
            return;
        }

        // restart watch
        if (!chokiWatcher) {
            // do not start watching folders straight away as there may be IO streams
            // being closed which will cause a "change" event for chokidar on the file.
            setTimeout(function () {
                watchFolders();
            }, 200); // delay for 200 milliseconds to be sure that chokidar won't freak out!
        }
    }
}

function validResponse(err, obj, db, map, fileRecord) {
    if (err) {
        notifyUser(msgCodes.COMPLEX_ERROR, {
            open: fileRecord.getRecordUrl()
        });
        handleError(err, db);
        return false;
    }

    if (obj.records.length === 0) {
        logit.info('No records found:'.yellow, db);
        fileRecord.addError("No records found");

        notifyUser(msgCodes.RECORD_NOT_FOUND, {
            table: map.table,
            file: map.keyValue,
            field: map.field,
            open: fileRecord.getRecordUrl()
        });
        return false;
    }

    return true;
}

function receive(file, allDoneCallBack) {
    var map = fileRecords[file].getSyncMap(),
        fileMeta = fileRecords[file].getMeta();

    logit.debug('Adding:', {
        file: file,
        table: map.table,
        field: map.field
    });

    // we are about to download something!!
    queuedFile();

    var snc = getSncClient(map.root);

    // note: creating a new in scope var so cb gets correct map - map.name was different at cb exec time
    var db = {
        table: map.table,
        field: map.field,
        query: map.key + '=' + map.keyValue,
        sys_id: fileMeta.sys_id || false
    };

    snc.table(db.table).getRecords(db, function (err, obj) {
        var isValid = validResponse(err, obj, db, map, fileRecords[file]);
        if (!isValid) {
            decrementQueue();
            allDoneCallBack(false);
            return false;
        }

        var record = obj.records[0],
            objData = record[db.field],
            objName = record.name; // TODO : use objName instead of file var.


        // legacy concept (still needed??... TODO: don't allow creation of 0 byte files!)
        if (record[db.field].length < 1) {
            logit.warn('**WARNING : this record is 0 bytes'.red);
            fileRecords[file].addError('This file was downloaded as 0 bytes. Ignoring sync. Restart FileSync and then make changes to upload.');

            notifyUser(msgCodes.RECEIVED_FILE_0_BYTES, {
                table: map.table,
                file: map.keyValue,
                field: map.field,
                open: fileRecords[file].getRecordUrl()
            });
        }

        logit.info('Received:'.green, db);


        writeFile(file, objData, function (complete) {

            var wasNewlyDiscovered = fileRecords[file].isNewlyDiscoveredFile();

            // already written file or ignored file
            fileRecords[file].setNewlyDiscoveredFile(false);

            // we did not write out the file because this would result in overwriting needed data
            if (!complete && wasNewlyDiscovered) {
                // send the process down the correct path
                logit.info('Local has been modified (not added) and will now be sent.');
                decrementQueue();
                send(file, allDoneCallBack);
                return; // don't do any callback.. we came down the wrong path anyway!
            }

            if (!complete) {
                notifyUser(msgCodes.RECEIVED_FILE_ERROR, {
                    table: map.table,
                    file: map.keyValue,
                    field: map.field,
                    open: fileRecords[file].getRecordUrl()
                });

                decrementQueue();
                allDoneCallBack(complete);

            } else {

                updateFileMeta(file, record);

                // write out hash for collision detection
                fileRecords[file].saveHash(record[db.field], function (saved) {
                    if (saved) {
                        notifyUser(msgCodes.RECEIVED_FILE, {
                            table: map.table,
                            file: map.keyValue,
                            field: map.field,
                            open: fileRecords[file].getRecordUrl()
                        });

                        logit.info('Saved:'.green, file);
                    } else {
                        logit.error('SERIOUS ERROR: FAILED TO SAVE META FILE FOR SYNC RESOLUTION.'.red);
                        notifyUser(msgCodes.COMPLEX_ERROR);
                    }

                    decrementQueue();
                    allDoneCallBack(saved);
                });
            }

        });
    });
}

/**
 * Writes out a file so long as it is empty
 */
function writeFile(file, data, callback) {
    // file was discovered as "new" by watcher (chokidar)
    var mustBeEmpty = fileRecords[file].isNewlyDiscoveredFile();

    // are we expecting that the file is empty?
    if (mustBeEmpty) {
        /*
         * File overwrite check here.
         * The file must either not exist or be empty before we attempt
         * to overwrite it. Fixes an edge case race condition where the chokidar watcher
         * thought that our file was empty (due to atomic saves?) but it really wasn't
         * this caused an "addFile" call instead of an "updateRecord" process :-(
         *
         */

        readFile();
    } else {
        outputFile();
    }


    function readFile() {
        fs.readFile(file, 'utf8', function (err, data) {
            if (err || data.length > 0) {
                callback(false);
            } else {
                outputFile();
            }
        });
    }

    function outputFile() {
        fs.outputFile(file, data, function (err) {
            if (err) {
                handleError(err, file);
                callback(false);
                return;
            }
            callback(true);
        });
    }
}

// it is expected that the file always exists (otherwise die hard)
function readFile(file, callback) {
    fs.readFile(file, 'utf8', function (err, data) {
        if (err) {
            notifyUser(msgCodes.COMPLEX_ERROR);
            logit.info(('Error trying to read file: '.red) + file);
            handleError(err, {
                file: file
            });
        } else {
            callback(data);
        }
    });
}

/**
 * push some data to overwrite an instance record
 * @param snc {snc-client}
 * @param db {object} - the data to use in the post...
 * var db = {
            table: map.table,
            field: map.field,
            query: map.key + '=' + map.keyValue,
            sys_id: fileMeta.sys_id || false,
            payload: {},
        };
        // payload for a record update (many fields and values can be set)
        db.payload[db.field] = data;

 * @param callback {function}
 */
function push(snc, db, callback) {
    snc.table(db.table).update(db, function (err, obj) {
        if (err) {
            handleError(err, db);
            callback(false);
            return;
        }

        callback(true);
    });
}

function send(file, callback) {

    // default callback
    callback = callback || function (complete) {
        if (!complete) {
            logit.error(('Could not send file:  ' + file).red);
        }
    };
    readFile(file, function (data) {

        var map = fileRecords[file].getSyncMap(),
            fileMeta = fileRecords[file].getMeta();

        var snc = getSncClient(map.root);
        var db = {
            table: map.table,
            field: map.field,
            query: map.key + '=' + map.keyValue,
            sys_id: fileMeta.sys_id || false,
            payload: {},
        };
        // payload for a record update (many fields and values can be set)
        db.payload[db.field] = data;


        // only allow an update if the instance is still in sync with the local env.
        instanceInSync(snc, db, map, file, data, function (err, obj) {

            if (!obj.inSync) {
                notifyUser(msgCodes.NOT_IN_SYNC, {
                    table: map.table,
                    file: map.keyValue,
                    field: map.field,
                    open: fileRecords[file].getRecordUrl()
                });
                logit.warn('Instance record is not in sync with local env ("%s").', map.keyValue);
                callback(false);
                return;
            }
            if (obj.noPushNeeded) {
                logit.info('Local has no changes or remote in sync; no need for push/send.');
                callback(true);
                return;
            }


            logit.info('Updating instance version ("%s").', map.keyValue);
            push(snc, db, function (complete) {
                if (complete) {
                    // update hash for collision detection
                    fileRecords[file].saveHash(data, function (saved) {
                        if (saved) {
                            notifyUser(msgCodes.UPLOAD_COMPLETE, {
                                file: map.keyValue,
                                open: fileRecords[file].getRecordUrl()
                            });
                            logit.info('Updated instance version: %s.%s : query: %s', db.table, db.field, db.query);
                            logit.debug('Updated instance version:', db);

                        } else {
                            notifyUser(msgCodes.COMPLEX_ERROR);
                        }
                        callback(saved);
                    });
                } else {
                    notifyUser(msgCodes.UPLOAD_ERROR, {
                        file: map.keyValue,
                        open: fileRecords[file].getRecordUrl()
                    });
                    callback(complete);
                }

            });
        });
    });
}

function addFile(file, callback) {

    if (!trackFile(file)) return;

    // default callback
    callback = callback || function (complete) {
        if (!complete) {
            logit.info(('Could not add file:  ' + file).red);
            multiDownloadStatus = DOWNLOAD_FAIL;
        }
    };

    logit.info('Syncing record from instance to file', file);
    receive(file, callback);
}

function onChange(file, stats) {
    if (fileHasErrors(file)) {
        return false;
    }
    if (stats.size > 0) {
        logit.info('Potentially syncing changed file to instance', file);
        send(file);
    } else {
        logit.info('Syncing empty file from instance', file);
        receive(file, function (complete) {});
    }
}

function fileHasErrors(file) {
    var f = fileRecords[file] ? fileRecords[file] : false;
    if (!f) {
        trackFile(file);
        return true;
    }
    var errors = f.errors();
    if (errors) {
        logit.info('This file (' + file + ') failed to work for us previously. Skipping it. Previous errors on file/record: ', errors);
        return true;
    }
    return false;
}

/*
 * Track this file in our fileRecords list.
 * Return the file or false if not valid
 */
function trackFile(file) {

    var f = fileRecords[file] ? fileRecords[file] : false;
    // existing, check for errors
    if (f) {
        if (fileHasErrors(file)) {
            return false; // can't process
        }
        return f;
    } else {
        // new, check if valid
        f = new FileRecord(config, file);
        if (f.validFile()) {
            fileRecords[file] = f;
        } else {
            return false; // not valid in terms of mapped files in config
        }
    }
    return f;
}

/*
 * Check if the server record has changed AND is different than our local version.
 *
 * Cases:
 *  1. computed hash of the file before and after is the same                  = PASS
 *  2. hash of the remote record and local file are the same                   = PASS
 *  3. hash of the previous downloaded file and the remote record are the same = PASS
 *     (nobody has worked on the server record)
 *
 *  All other scenarios are considered a FAIL meaning that the instance version is
 *  not in sync with the local version.
 *
 * If file and record are in sync then inSync is true.
 * If case 3 then noPushNeeded is false to signify that the remote version can
 * be updated.
 */
function instanceInSync(snc, db, map, file, newData, callback) {

    // first lets really check if we have a change
    var previousLocalVersionHash = fileRecords[file].getLocalHash();
    var newDataHash = makeHash(newData);
    if (previousLocalVersionHash == newDataHash) {
        callback(false, {
            inSync: true,
            noPushNeeded: true
        });
        return; // no changes
    }

    logit.info('Comparing remote version with previous local version...');

    snc.table(db.table).getRecords(db, function (err, obj) {
        obj.inSync = false; // default to false to assume not in sync (safety first!)
        obj.noPushNeeded = false; // default to false to assume we must upload

        var isValid = validResponse(err, obj, db, map, fileRecords[file]);
        if (!isValid) {
            callback(err, obj);
            return false;
        }

        logit.info('Received: %s.%s query: %s sys_id ? %s'.green, db.table, db.field, db.query, db.sys_id);
        logit.debug('Received:'.green, db);

        var remoteVersion = obj.records[0][db.field],
            remoteHash = makeHash(remoteVersion);

        // CASE 1. Records local and remote are the same
        if (newDataHash == remoteHash) {
            // handle the scenario where the remote version was changed to match the local version.
            // when this happens update the local hash as there would be no collision here (and nothing to push!)
            obj.inSync = true;
            obj.noPushNeeded = true;
            // update local hash.
            fileRecords[file].saveHash(newData, function (saved) {
                if (!saved) {
                    logit.error('Failed to update hash file for %s', file);
                }
            });

            // CASE 2. the last local downloaded version matches the server version (stanard collision test scenario)
        } else if (remoteHash == previousLocalVersionHash) {
            obj.inSync = true;
        }
        // CASE 3, the remote version changed since we last downloaded it = not in sync
        callback(err, obj);
    });
}


function watchFolders() {

    // Watching folders will currently screw up our testing so don't do it when running tests.
    if (testsRunning) return;

    logit.info('*********** Watching for changes ***********'.green);
    var watchedFolders = Object.keys(config.roots);
    chokiWatcher = chokidar.watch(watchedFolders, {
            persistent: true,
            // ignores use anymatch (https://github.com/es128/anymatch)
            ignored: chokiWatcherIgnore,
            // performance hit?
            alwaysStat: true
        })
        .on('add', function (file, stats) {

            if (chokiWatcherReady) {

                // ensure a file object exists
                if (trackFile(file)) {
                    // ensure file is really empty
                    if (stats && stats.size > 0) {
                        // these files can be ignored (we only process empty files)
                        return;
                    } else {

                        // track file as a newly discovered file
                        fileRecords[file].setNewlyDiscoveredFile(true);

                        addFile(file);
                    }
                }

            } else {
                trackFile(file);
            }
        })
        .on('change', onChange)
        .on('ready', function () {
            chokiWatcherReady = true;
        })
        .on('error', function (error) {
            logit.error('Error watching files:'.red, error);
        });
    // TODO : clear up old hash files when files removed..
    // .on('unlink', function(path) {logit.info('File', path, 'has been removed');})
}

// for each root create the folders because we are lazy ppl
function setupFolders(config, callback) {
    var dirsExpected = 0,
        dirsCreated = 0;

    dirsExpected = Object.keys(config.roots).length * Object.keys(config.folders).length;

    function dirError(err) {
        if (err) logit.info(err);
        dirsCreated++;
        if (dirsCreated >= dirsExpected) {
            // we are done creating all the folders
            callback();
        }
    }

    // for each root create our dirs
    for (var r in config.roots) {
        for (var f in config.folders) {
            var newDir = path.join(r, f);
            fs.ensureDir(newDir, dirError);
        }
    }
}

/*
 * @debug Bool : true to set log level to (include) debug
 */
function setupLogging() {
    var logger = new(winston.Logger)({
        transports: [
        new(winston.transports.Console)({
                timestamp: function () {
                    return moment().format("HH:mm:ss");
                    //return moment().format("YY-MM-DD HH:mm:ss");
                    //return Date.now();
                },
                colorize: true,
                prettyPrint: true
            })
    ]
    });

    // support easier debugging of tests
    logit.test = function () {
        console.log('...............');
        if (typeof arguments[0] == 'string') {
            this.info(arguments[0].underline);
        } else {
            this.info(arguments[0]);
        }
        for (var i = 1; i < arguments.length; i++) {
            this.info(' - ', arguments[i]);
        }
        //console.log('...............');
    };

    logger.extend(logit);

    if (config.debug) {
        logger.level = 'debug';
    }

    // support for 3rd party logging (eg, FileRecord, notify and Search)
    config._logger = logit;
}



init();

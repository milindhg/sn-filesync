sn-filesync -- ServiceNow FileSync (v4.1.2)
=================

[![NPM](https://nodei.co/npm/sn-filesync.png)](https://nodei.co/npm/sn-filesync/)

[![Intro to FileSync](https://raw.githubusercontent.com/dynamicdan/filesync/master/thumbnail.png)](https://www.youtube.com/watch?v=OlVllfPVOrA "Intro to FileSync")

**Contents**

 * [Intro](#intro)
 * [Overview](#overview)
 * [Intall and Setup](#intall-and-setup)
   * [Configuration](#configuration)
   * [Usage](#usage)
   * [app.config.json settings](#appconfigjson-settings)
 * [Advanced settings](#advanced-settings)
   * [Folder definitions (optional)](#folder-definitions-optional)
     * [Sub Directory Pattern usage](#sub-directory-pattern-usage)
   * [Config options](#config-options)
     * [Root specific options](#root-specific-options)
   * [Exporting current setup](#exporting-current-setup)
   * [SASS CSS pre-compiler support](#sass-css-pre-compiler-support)
 * [Search and download](#search-and-download)
   * [Search Overview](#search-overview)
   * [Search Usage](#search-usage)
   * [Search Command Line Usage](#search-command-line-usage)
   * [Tips for Searching](#tips-for-searching)
 * [Road Map](#road-map)
 * [Contribution workflow](#contribution-workflow)
 * [Changes](#changes)
 * [Architecture](#architecture)
 * [Windows support](#windows-support)

## Intro

This is a **maintained** fork of the fruition-parteners filesync repo. This repository adds support for current versions of ServiceNow, cleans up code management (to allow more contribution!) and provides further solutions to common "editing in ServiceNow environment" issues (eg, conflict saves). See the **Road Map** below for more info. **Contributors wanted!**


## Overview

FileSync synchronises ServiceNow instance field values to local files and syncs file changes back to the applicable record.

This enables ServiceNow developers to use their favourite integrated development environments (IDEs) and text editors
like WebStorm, Sublime and [Brackets](http://brackets.io/) for editing JavaScript, HTML, Jelly and other code - without wasting time and interrupting
development workflow copying and pasting code into a browser.

Fields from records can be synced down manually or automatically via the `--search` option; this works with ServiceNow sysparm_query values.

Running a `--resync` (optional) will re-download all existing downloaded record fields to ensure the local copies are always in sync.

Conflict management also detects if the server version has changed before trying to upload local changes that may be outdated.


## Intall and Setup

Older versions of FileSync include all relevant node modules and the node engine required to run FileSync. If you want a quick install/test then follow the instructions for FileSync tag [v3.0.5](https://github.com/dynamicdan/filesync/tree/v3.0.5) (stable).

Install steps (v4.0.0+):

1. [Download node](http://www.nodejs.org) version 5.6.0 or later. This will include the NPM module which is used to install the dependencies. NPM must be v3.6.0 or later.
* Checkout or **[download this repository](https://github.com/dynamicdan/filesync/archive/master.zip)** and watch the **[intro video](https://www.youtube.com/watch?v=OlVllfPVOrA)** that explains the concept and starting points.
* Once node is installed, navigate to the FileSync folder you downloaded and run `npm install`. This will populate the `node_modules` directory. If you are behind a proxy or can't install node via the binary (to get npm) then you may have to run this on another machine and send yourself a zip archive of the directory.
* Confirm setup is complete by running `node bin/app.js --help`. This should show a list of options.
* Follow the configuration section below and setup the **[app.config.json](#appconfigjson-settings)** file.

The original video for installing, configuring and using FileSync for v.0.1.0 can also be found [here](https://vimeo.com/76383815).

### Configuration

**Step 1.** Ensure that your instance is running with a version greater or equal to Eureka to make use of the JSONv2 API (enabled by default). For versions prior to Eurkea use the [older version of FileSync](https://github.com/fruition-partners/filesync).

**Step 2.** Create a folder on your computer where the records will be saved.

**Step 3.** Edit **app.config.json**.

* Review the **app.config.json settings** section below for guidance. **Please read all comments.**
* Configure a root (project) folder including the host, user and pass. **"user"** and **"pass"** will be encoded and replaced
by an **"auth"** key at runtime.
* **Note:** You must restart FileSync any time you update app.config.json.

### Usage

FileSync is primarily driven via the command line. Windows users can of course create a `.bat` file for easier startup. Mac users could likewise create a `.command` file.

The following demos assume a config file in `~/project/test/config.json` and records in `~/project/test/records/`

**Start**

`node bin/apps.js --config ~/project/test/config.json`

**Download the script field from a script include**

`touch ~/project/test/records/script_includes/JSUtil.js`

**Get help on options**

`node bin/app.js --help`

**Use search to find records to sync**

`node bin/apps.js --config ~/project/test/config.json --search mine`

**Use search to download found records**

`node bin/apps.js --config ~/project/test/config.json --search mine --download`

See also [Search Command Line Usage](#search-command-line-usage) for more details.



As you make changes to mapped files, you'll see messages logged showing the sync processing.

If you are using the default config then you will already have all the appropriate folders created for you and some test script include files that will have been downloaded from the instance. See "preLoad" and "createAllFolders" options below.

Additionally, you can sync more files by adding an empty file corresponding to an instance record.  You can do this from your editor
or IDE, or via the command line.

Adding the empty JSUtil.js file will cause FileSync to sync the (OOB) JSUtil script include to the file. Any changes to
this local file will now be synced to the mapped instance.

The basic workflow is to initially create a script on ServiceNow (script include, business rule, ui script, etc.), then
add an empty file of the same name (and mapped extension) to a mapped local folder.

FileSync can not support creating new records in ServiceNow by simply adding local files since there are
additional fields and rules that can not be evaluated locally. Always start by creating a new
record on the instance, then add the empty local file and start editing your script.

### app.config.json settings

*Comments are included below for documentation purposes but are not valid in JSON files. You can validate JSON at
<http://www.jslint.com/>*

Example app.config.json (see also the included app.config.json file):

```javascript
    {
        // maps a root (project) folder to an instance
        "roots": {
            "c:/dev/project_a": {                   // full path to root folder
                                                    // on Windows, ensure that the same forward slashes are used!
                "host": "demo001.service-now.com",  // instance host name
                "user": "admin",                    // instance credentials
                "pass": "admin"                     // encoded to auth key and re-saved at runtime
            },
            "c:/dev/project_b": {                 // add additional root mappings as needed
                "host": "demo002.service-now.com",
                "auth": "YWRtaW46YWRtaW4="          // example of encoded user/pass
            },
            "/Users/joe.developer/instance/records": { // mac os non-https example
                "host": "some.instance.com:16001",
                "protocol": "http",                    // if https is not supported then force http here
                "auth": "YWRtaW46YWRtaW4=",
                "preLoadList": {
                    "script_includes": ["JSUtil.js",
                                        "Transform.js"] // specify a list of files to create and sync on
                                                        //   startup (see preLoad below)
                }
            }
        },

        "preLoad": true,                            // create files as defined above per root in "preLoad"
        "createAllFolders": true,                   // create local folders to save on manual effort

        "debug": false                              // set to true to enable more detailed debug logging

    }
```



## Advanced settings

### Folder definitions (optional)

Folder definitions map fields and records from the instance to a local directory structure. Creating an empty file in a specific mapped directory will then cause a download of that record field based on the file name and suffix used.

A default list of folder definitions exists in `lib/records.config.json` for easier setup. This list can be extended or overridden. If you want to start from scratch then set `ignoreDefaultFolders` to `true`. For most users, the default list covers all needs. The list can be updated at any time but ensure you restart the FileSync tool after making changes to get the new mapping.

See the **lib/records.config.json** file for sample definitions.

```javascript

    "roots" { .... },

    // maps a sub folder (of a root folder) to a table on the configured instance
    "folders": {
        "script_includes": {                    // folder with files to sync
            "table": "sys_script_include",      // table with records to sync to
            "key": "name",                      // field to match with filename to ID unique record
            "fields": {                         // file contents are synced to a field based on filename suffix
                "js": "script"                  //   files ending in .js will sync to script field
            }
        },
        "business_rules": {
            "table": "sys_script",
            "key": "name",
            "fields": {
                "js": "script"
            },
            "subDirPattern": "collection/active_<active>/when" // results in "business_rules/incident/active_true/before/mark_closed.js
                                                               //   see below for pattern usage.
        },
        "ui_pages": {
            "table": "sys_ui_page",
            "key": "name",
            "fields": {                          // multiple fields for the same record can be mapped to multiple
                "xhtml": "html",                 //   files by using different filename suffixes
                "client.js": "client_script",    //   for ui pages, you might have three separate files:
                "server.js": "processing_script" //    mypage.xhtml, mypage.client.js, mypage.server.js
            }                                    //   to store the all script associated with the page
        }
        ...
    },
```

#### Sub Directory Pattern usage

It is possible not only to group records by table but also by other attributes on the record. The `subDirPattern` property allows specifying additional sub directories that should be used to group your record fields. It's possible to use both field values and strings as desired. If the attribute provided is not an attribute on the record then it will be ignored.

Using Sub directory patterns brings more context to the saved fields and helps avoid doing things like working on records that are in-active. The default folder config includes some patterns as defaults which can be overridden.

Samples:

````

    "client_scripts": {
        "table": "sys_script_client",
        "key": "name",
        "fields": {
            "js": "script"
        },
        "subDirPattern": "table", // results in client_scripts/incident/Highlight VIP Caller.js
    },

````

Mixed Attributes:

````

    "subDirPattern": "active_<active>/type", // results in client_scripts/active_true/onChange/Highlight VIP Caller.js
````

````

    "subDirPattern": "active/table/from_<sys_created_by>", // results in client_scripts/true/incident/from_glide.maint/Highlight VIP Caller.js
````

NOT supported:

````

    "subDirPattern": "table_<table>_<type>" // multiple attributes per sub directory name
````


### Config options

Property | Values | Default | Purpose
------------ | -------------------- | ------------- | -------------
debug | Bool: true / false | false | Enable more verbose debugging. Useful to troubleshoot connection issues.
ignoreDefaultFolders | Bool: true / false | false | If false then utilise record to folder mapping defined in **lib/records.config.json**.<br />If true then the **"folders"** property must be set as described below.
folders | Object listing folders | not set (inherited) | See **lib/records.config.json** as an example for format and usage. If this property is defined then it will override that defined in **lib/records.config.json** on a per folder level. This is an easy way to specify more mappings without modifying core files. If "ignoreDefaultFolders " is set to true then **lib/records.config.json** is completely ignored and all mappings must be defined in the "folders" property.
createAllFolders | Bool: true / false | false | Creates all folders specified by folders (if set) or the default **lib/records.config.json** file.
preLoad | Bool: true / false | false | Creates local files that can be specified per root setting "`preLoadList`" (defined below). Set to false to ignore the property. Note that files that already exist are ignored but there is however a slight performance cost if you leave this option set to true. <br />**TIP**: set to false once files have been created.
ignoreList | Array of matches | `/[\/\\]\./` | Define what files are **not** tracked for changes. Defaults to ignore hidden files on any directory level (eg `.sync_data`). Usage details can be found on the [chokidar readme](https://github.com/paulmillr/chokidar#path-filtering).
ensureUniqueNames | Bool: true / false | false | If set to true then files will be post-fixed with the record sys_id to ensure all saved files have unique names. This supports records that have the same name on the same table. By default this is false to encourage more useful record names on the instance.
proxy | Object | not set | Required if stuck behind a proxy. <br />Eg. `"proxy": { `<br />`"host": "host.com",`<br />`"port": "3860"`<br />` }`


#### Root specific options

Use on the same level where host is defined.

Property | Values | Default | Purpose
------------ | -------------------- | ------------- | -------------
preLoadList | Object listing folders and files | n/a |  Defines a list of files to automatically download per folder. Saves on manual file creation efforts <br />Eg: <br />``` preLoadList: { ```<br />  ```  "business_rules": ["my special rule.js", "Another rule.js"]```<br />```}```
protocol | "http" | https | If https is not supported then force http usage

### Exporting current setup

It is a burden to download the various records in the correct folders when getting started. To alleviate this there is an export function that will generate a config file with the `preLoadList` filled in.

This is also useful if you want to create a backup of your current setup.

Command Line Usage:

````
./node-darwin src/app --config <config to use> --export <new config file>
````

Eg.
````
./node-darwin src/app --config ~/.filesync/app.config-acme.json --export ~/Desktop/acme.config.json
````

The resulting json file will **not** include your authentication information. It will include the folder setup you used and a preLoadList listing all the records you have previously downloaded. This is very handy for getting new team members setup and providing them an easy reference to important files. Eg, for CMS development this could mean theme CSS/SASS, UI Macros, UI Pages and various script includes.


### SASS CSS pre-compiler support

It is possible to use FileSync with [compass](http://compass-style.org/) or [SASS](http://sass-lang.com/) to generate your CSS for CMS theme development. To do this we specify a folder definition in your config file like so:

```
"folders": {
        "theme_sass": {
            "table": "content_css",
            "key": "name",
            "fields": {
                "scss": "style"
            }
        }
    },
```

Your file hierarchy would then look like this:

```
/project/records/style_sheets/base.css
/project/records/style_sheets/service_catalog.css

/project/records/theme_sass/_vars.scss
/project/records/theme_sass/base.scss
/project/records/theme_sass/service_catalog.scss
/project/records/theme_sass/_ootb_service_catalog.scss

/project/compass/config.rb
/project/compass/.sass-cache/
```

In this setup "theme_sass" holds your scss files/records including partials named on the instance like "base_scss" and "_vars_scss". The **"_scss"** part is important both from a FileSync technical perspective and for your successor or future maintainer. If your sass files do not use the **".scss"** suffix and your records do not contain **"_scss"** at the end then the sync process won't work.

Your config.rb file is then configured to output the css generated files to the "style_sheets" folder. The config.rb file would then be configured like this:

````
css_dir = "../records/style_sheets"
sass_dir = "../records/theme_sass"
````

On the instance you then simply create 2 themes. One that is used by your CMS (where "style_sheets" are uploaded to) and another that is used for development (where "theme_sass" SCSS files are uploaded). We start watching for SASS changes using the command: "`compass watch /project/compass`" and when compass outputs the new files they will be detected by FileSync and uploaded (including the SCSS files that have changed).

Using this setup ensures that the customer will have all the files needed to do further development in case they want to use SASS or plain CSS files. If another developer wanted to work on the theme but didn't have compass/SASS configured then they could use an extra CSS record/file.

## Search and Download

### Search Overview

The search feature supports 3 activites:
 1. **Demo** mode to test out the tool and your connection.
 1. **Custom search** that works with sysparm_query and your desired table(s) to search for records. Note that by default all tables defined under the ```folders``` config are searched if the ```table``` option is not provided.
 1. **Download** option. Set to true when the search results match what you want in order to start syncing. When false or not set the search system displays found results but will not save the records to files.

Additionally it's possible to set the max amount of records returned per search (instance default is normally 10,000) and specify a specific table to search on (so long as it's mapped in your *folders* config).

### Search Usage

The search component enforces using the config file instead of the command line to define the search criteria. This helps by saving commonly used search settings. Below is a sample configuration that also exists in the default config file. Note that the query used is exactly the same as the **sysparm_query** used when filtering list views or when working with **encoded queries**.

```javascript

    "roots": { ... },
    "search": {
        "mine": {
            "query": "sys_updated_by=admin",
            "records_per_search": "3",
            "download": true
        },
        "team": {
            "query": "sys_created_on>javascript:gs.dateGenerate('2015-03-25','23:59:59')^sys_created_by!=javascript:gs.getUserName()^sys_updated_by!=javascript:gs.getUserName()^sys_created_by!=admin^ORDERBYDESCsys_updated_on",
            "records_per_search": "100",
        },
        "script-includes": {
            "table": "sys_script_include", // limit to just one table
            "query": "sys_created_on>javascript:gs.dateGenerate('2015-03-25','23:59:59')",
            "records_per_search": "1",
            "download": true // download all founds results
        }
    },

```

### Search Command Line Usage

 * Test the search system in demo mode:
 ```
 ./node-darwin src/app --config ~/my-conf.json --search
 ```
 * Search based on a pre-defined search config (defined in *my-conf.json*):
 ```
 ./node-darwin src/app --config ~/my-conf.json --search mine
 ```
 * Download records found via search (overwrites existing local files if they exist):
```
./node-darwin src/app --config ~/my-conf.json --search mine --download
```

Note that the defaults are to search in demo mode without downloading any records.

### Tips for Searching

Search unlocks a great deal of potential. Here are some ideas showing how you can benefit from using search.

* No need to create your files anymore. Simply always use search to download all files created or updated by you.
* Bulk updates? Simply download all the records created since instance development started and use your favourite editor to bulk search and replace. 1000 records could take seconds compared to the hours via the instance interface.
* Look for bad practice. Search across all tables of interest for scripts that don't use best practice naming conventions.
 * Run your own health report. Download all fields of interest and then run your own RegEx queries to look for configuration issues.
* Quickly and easily take over from a colleague. If they are going on holiday then just download the records they worked on recently and not worry about them forgetting to tell you where the important stuff is!
* Export all description content or story content or ANY attribute from any table in bulk. Could identify documentation issues.
 * Export entire records but only the fields of interest. Eg, description field, script field, last modification date etc.


## Road Map

Considering ServiceNow does not handle merge conflicts at all, this is a major goal of this tool! Contributions to help achieve this road map or improve the tool in general are **greatly** appreciated.

- [ ] instance comparison (eg. compare specific tables based on custom records)]
- [ ] extend API to allow push and pull options that could be called from an external tool
- [ ] allow configuring pre and post hooks (similar to a Grunt/Gulp/Git systems)
- [ ] add pre-push hook for validation against best practice, JSHint and customisable rule sets
- [ ] allow saving complete record as XML (via search tool)
- [ ] when an update conflict has been detected write out the remote file and launch a diff app (command line "diff" or mac OS XCode "FileMerge" via "`opendiff <left> <right>`") for the user to help resolve the differences
- [ ] allow upload override of server record if the user has made a merge of remote and local data
- [ ] split out components into separate modules (eg, sn-search, sn-sync, sn-rest)

Nice to haves

- [ ] config option to log details to log file (help others send log info)
- [ ] offline support? (keep track of files that are queued to upload when the connection is available again and retry).. maybe not. This could be dangerous if records get updated without someone to test them. Potentially workable if the last queued file is less than 3 minutes ago to cater for flaky mobile/roaming connections.



## Contribution workflow

Here’s how we suggest you go about proposing a change to this project:

1. [Fork this project][fork] to your account.
2. [Create a branch][branch] for the change you intend to make.
3. Make changes to this branch.
4. [Send a pull request][pr] from your fork’s branch to the `experimental` branch.

Using the web-based interface to make changes is fine too, and will help you
by automatically forking the project and prompting to send a pull request too.

[fork]: http://help.github.com/forking/
[branch]: https://help.github.com/articles/creating-and-deleting-branches-within-your-repository
[pr]: http://help.github.com/pull-requests/


## Changes

See [CHANGES.md](https://github.com/dynamicdan/filesync/blob/master/CHANGES.md)


## Architecture

FileSync was built using [Node.js](http://nodejs.org/), a platform built on Chrome's JavaScript runtime.


* README.md + CHANGES.md - help, written in [Markdown][Markdown] syntax
* app.config.json - default/sample configuration file to specify instance connection details and other options
* node_modules - folder containing 3rd-party node.js modules (from NPM) used to build app
* bin/app.js - main application that watches for file changes
* lib/search.js - manages querying for data (utilises sysparm_query)
* lib/notify.js - user friendly system notifications when records have been downloaded or updated
* lib/upgrade.js - ensures that users that upgrade can easily resolve *breaking* changes
* lib/records.config.json - default folder definitions (that can be overwritten in app.config.json files)
* lib/config.js - a module used to load and validate the specified config file (app.config.json)
* lib/snc-client.js - a module that interacts with SN JSON Web Service to receive and send updates to an instance
* lib/file-record.js - utility module for working with files/records
* lib/tests.js - runs various tests to ensure no major breaking changes between versions
* [root folder] / .sync_data/ - a directory used to store sync information to help synchronise with the instance

[Markdown]: http://daringfireball.net/projects/markdown/

## Windows support

The original version supports windows without any issues. As I don't use windows, I can't easily test the fixes and features I've added in this repo. If you would like to help test and fix things for windows then please submit a pull request or contact me.

Below is a summary of windows support

Feature | Windows | Mac
------------ | ------------ | -------------
Notifications | Windows OS Bubble notifications | Y
Home dir config | Not tested | Y
Exporting current setup | Not tested | Y
CSS SASS support | Not tested | Y
Search | Y | Y

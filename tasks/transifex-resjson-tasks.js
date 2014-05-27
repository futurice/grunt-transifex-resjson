module.exports = function (grunt) {
    "use strict";

    var request = require("request");
    var crypto = require("crypto");

    var _ = require("underscore");
    var q = require("q");

    var rjson = require("relaxed-json");


    /* 
       Constant read from the module configuration file
     */
    var TX_API;
    var TX_AUTH; 
    var TX_PROJECT_SLUG; 
    var TX_COORDINATORS;
    var TX_MAIN_RESOURCE_SLUG;
    var TX_TRANSLATION_MODE;
    var STRINGS_PATH;
    var SOURCE_LANG_STRINGS_PATH;
    var COMMENT_PREAMBLE_FILE;
    var TX_SOURCE_LANGUAGE;
    var IGNORED_RESOURCES;

    var transifexConfig;

    function setupTransifexConfig() {

      var configFile = grunt.config("transifex-resjson.transifex_resjson_config");

      if (!configFile) {
        grunt.fail.warn("no 'transifex_resjson_config' property set");
      }


      try {
        transifexConfig = readConfigs(configFile);
      } catch(e) {
        grunt.fail.warn("could not find config file for transifex-resjson");
      }

      TX_API = transifexConfig.transifex.api;
      TX_AUTH = transifexConfig.transifex.auth;

      TX_PROJECT_SLUG = transifexConfig.transifex.projectSlug;
      TX_COORDINATORS = transifexConfig.transifex.langCoordinators;

      TX_MAIN_RESOURCE_SLUG = transifexConfig.transifex.mainResourceSlug;
      STRINGS_PATH = transifexConfig.localProject.stringsPath;
      SOURCE_LANG_STRINGS_PATH = transifexConfig.localProject.sourceLangStringsPath;
      COMMENT_PREAMBLE_FILE = transifexConfig.localProject.commentPreambleFile;
      TX_SOURCE_LANGUAGE = transifexConfig.transifex.sourceLanguage;

      // optional config options
      TX_TRANSLATION_MODE = transifexConfig.transifex.translationMode || "default";
      IGNORED_RESOURCES = transifexConfig.localProject.ignoredResources || [];
    }

    grunt.registerTask("tx-project-resources", "Get project status from Transifex", function () {
        setupTransifexConfig();

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resources/";

        var done = this.async();
        request.get({
            url: action,
            auth: TX_AUTH
        }, function (error, response, body) {
            if (response.statusCode === 200) {
                body = JSON.parse(body);
                if (_.isEmpty(body)) {
                    grunt.log.writeln("No resources found. You can add resources to Transifex with tx-add-resource task.");
                } else {
                    grunt.log.writeln("Project resources in Transifex:");
                    body.forEach(function (resource) {
                        grunt.log.writeln(resource.name);
                    });
                }
                done(true);
            } else {
                grunt.log.writeln("Received error: [" + response.statusCode + "] " + body);
                done(false);
            }
        });
    });

    grunt.registerTask("tx-pull-translations", "Fetch translation files with reviewed translations from Transifex", function (args) {
        setupTransifexConfig();
        var done = this.async();

        var langCodes = (args === undefined) ? [] : args.split(/,/).map(mapToTxLangCode);

        txGetTranslatableResources(langCodes)
        .then(function (resources) {
            return q.all(resources.map(txPullTranslation));
        })
        .then(function (results) {
            results.forEach(function (result) {
                createTranslationFile(result);
            });
        }).done(function onSuccess() {
            done(true);
        }, function onError(err) {
            grunt.log.error(err);
            done(false);
        });
    });

    grunt.registerTask("tx-push-resources", "Push all the resources from the source language directory to Transifex", function () {
        setupTransifexConfig();
        var done = this.async();

        var resources = [];

        grunt.file.recurse(SOURCE_LANG_STRINGS_PATH + "/", function (abspath, rootdir, subdir, filename) {
            if (!isIgnoredResource(filename) && filename.match(/\.resjson$/)) {
                var slug = filename.replace(/\.resjson/, "");
                resources.push(slug);
            }
        });

        var promises = resources.map(txPushResource);
        q.allSettled(promises).then(function (results) {
            var taskResult = true;
            _.forEach(results, function (promise, i) {
                var resource = resources[i];
                if (promise.state === "fulfilled") {
                    var result = promise.value;
                    grunt.log.ok("Resource " + resource + " updated: ");
                    grunt.log.ok("Strings added: " + result.strings_added + ", strings updated: " + result.strings_updated + ", strings deleted: " + result.strings_delete);
                } else {
                    grunt.log.error("Failed to push resource " + resource + ": " + promise.reason);
                    grunt.log.error("Check that the resource is already added into Transifex.");
                    taskResult = false;
                }
            });
            return taskResult;
        }).done(function (result) {
            done(result);
        });
    });

    grunt.registerTask("tx-create-translation-language", "Provisions language to Transifex project", function (lang) {
        setupTransifexConfig();
        var done = this.async();

        var langCodes = [];
        if (arguments.length === 0) {
            grunt.log.error("Usage: grunt tx-create-translation-language:<lang-code|all>");
            done(false);
        } else if (lang === "all") {
            //get all languages from the strings folder except for the source language and
            //map the lang codes from xx-YY to xx_YY before creating the language
            var subDirectories = grunt.file.expand(STRINGS_PATH + "/*");
            _.forEach(subDirectories, function (dirname) {
                if (grunt.file.isDir(dirname)) {
                    var txLangCode = mapToTxLangCode(dirname);
                    if (txLangCode && txLangCode !== TX_SOURCE_LANGUAGE) {
                        langCodes.push(txLangCode);
                    }
                }
            });
        } else {
            langCodes.push(lang);
        }
        var promises = langCodes.map(txCreateLanguage);
        q.allSettled(promises).done(function (results) {
            done(true);
        }, function onError(err) {
            grunt.log.error(err);
            done(false);
        });
    });

    /*
        Push a new resource file into Transifex.
        "grunt tx-add-resource --file='123123123.resjson' --name='Name for Transifex UI'"
        The file is given without path and is assumed to reside at 
        `options.localProject.sourceLangStringsPath`.
    */
    grunt.registerTask("tx-add-resource", "add a new resource file in Transifex", function () {
        setupTransifexConfig();
        function failAndPrintUsage(errorMessage) {
            var usageMessage = "Usage: grunt " + grunt.task.current.nameArgs + " --file=12345.resjson [--name='Display name in Transifex']";
            failGruntTask(usageMessage, errorMessage);
        }
 
        var done = this.async();

        var fileOpt = grunt.option("file");
        var file = SOURCE_LANG_STRINGS_PATH + "/" + fileOpt;
        var displayName = grunt.option("name");

        if (!fileOpt) {
            failAndPrintUsage("no --file option defined");
        }

        if (!grunt.file.exists(file)) {
            failAndPrintUsage(file + " doesn't exist");
        }

        if (isIgnoredResource(fileOpt)  && !grunt.option("force")) {
            failAndPrintUsage(file + " is listed in ignoredResources, use --force to add it anyway");
        }

        var jsonContent = rjson.parse(grunt.file.read(file));
        var slugName = fileOpt.replace(/\.resjson$/, "");

        if (!displayName) {
            displayName = slugName;
        }

        pruneEmptyTranslationStrings(jsonContent);
        pruneOrphanComments(jsonContent);
        var jsonString = JSON.stringify(jsonContent, null, 2);

        txCreateResource(displayName, slugName, jsonString).done(function onSuccess(result) {
            grunt.log.ok("Uploaded resource " + slugName);
            done(true);
        }, function onError(result) {
            grunt.log.error("Error while creating resource:", result);
            done(false);
        });
   });


    /*
     * Push a single translation key to Transifex. The key is given as the first argument and optionally a list
     * of languages to update as the second argument.
     *
     * E.g. grunt tx.push-translation-key:resource:some.key:fi-FI,jp-JP
     */
    grunt.registerTask("tx-push-translation-key", "push single translation key to Transifex", function(resource, key, langs) {
        setupTransifexConfig();

        function failAndPrintUsage(errorMessage) {
            var usageMessage = "Usage: tx-push-translation-key:key.to.update:resource:[:list of languages]";
            failGruntTask(usageMessage, errorMessage);
        }

        var done = this.async();

        if (arguments.length < 2) {
            failAndPrintUsage("No translation key and resource defined");
        }

        if (!resourceFileExists(resource)) {
            done(false);
            grunt.fail.fatal("No resource file " + resource + ".resjson found");
        }

        var langCodes;
        if (arguments.length === 3) {
            langCodes = langs.split(/,/);
        } else  {
            langCodes = getTranslationCodes();
        }

        var translations = [];
        var fileRegExp = new RegExp("^" + resource + "\\.resjson");
        grunt.file.recurse(STRINGS_PATH, function (abspath, rootdir, subdir, filename) {
            if (filename.match(fileRegExp) && !isIgnoredResource(filename) && _.contains(langCodes, subdir)) {
                var jsonContent = rjson.parse(grunt.file.read(abspath));
                if (jsonContent[key]) {
                    translations.push({
                            lang: mapToTxLangCode(subdir),
                            key: key,
                            translation: jsonContent[key],
                            resource: filename.replace(/\.resjson/, ""),
                        });
                }
            }
        });

        if (_.isEmpty(translations)) {
            done(false);
            grunt.fail.fatal("No keys for " + key + " found");
        }

        var taskResult = true;
        var promises = translations.map(txPushSingleTranslation);
        q.allSettled(promises).then(function onSuccess(results) {
            _.forEach(results, function (result, i) {
                if (result.state === "fulfilled") {
                    grunt.log.ok("Translation for '" + key +"' in resource '" + resource + "' updated to '" + translations[i].translation + "' for language "+ translations[i].lang);
                } else {
                    grunt.log.error("Failed to update translation of '"+ key +"' in resource '" + resource + "' for language "+ translations[i].lang);
                    taskResult = false;
                }
            });
            return taskResult;
       }).done(function (result) {
            done(result);
       });
    });


    /* 
     *  Push translation files, i.e. all resource files except for the source language, to Transifex.
     */
    grunt.registerTask("tx-push-translations", "push translations to Transifex", function (lang) {
        setupTransifexConfig();

        var done = this.async();

        var subDirectories = [];
        if (arguments.length !== 0) {
            subDirectories.push(STRINGS_PATH + "/" + lang);
        } else {
            subDirectories = grunt.file.expand(STRINGS_PATH + "/*");
        }

        var resourceFiles = {};
        _.forEach(subDirectories, function (dirname) {
            var txLangCode = mapToTxLangCode(dirname);
            if (txLangCode && txLangCode !== TX_SOURCE_LANGUAGE) {
                resourceFiles[txLangCode] = [];
                grunt.file.recurse(dirname, function (abspath, rootdir, subdir, filename) {
                    if (!isIgnoredResource(filename) && filename.match(/\.resjson$/)) {
                        var slug = filename.replace(/\.resjson/, "");
                        resourceFiles[txLangCode].push({ path: abspath, slug: slug });
                    }
                });
            }
        });

        var promises = [];
        _.forEach(resourceFiles, function (resources, lang) {
            resources.forEach(function (resource) {
                var promise = txPushTranslation(resource.path, resource.slug, lang);
                // add metadata for the promises
                promise.lang = lang;
                promise.resource = resource.slug;
                promises.push(promise);
            });
        });

        q.allSettled(promises).then(function onSuccess(results) {
            var taskResult = true;
            _.forEach(results, function (promise, i) {
                var data = promises[i];
                if (promise.state === "fulfilled") {
                    var result = promise.value;
                    grunt.log.ok("Translation for " + data.lang + " of resource " + data.resource + " uploaded to Transifex");
                    grunt.log.ok("String added: "+ result.strings_added +", updated: " + result.strings_updated +", deleted: " + result.strings_delete);
                } else {
                    grunt.log.error("Failed to push " + data.lang + " translation for " + data.resource + ": " + promise.reason);
                    taskResult = false;
                }
            });
            return taskResult;
        }).done(function (result) {
            done(result);
        });
    });

    grunt.registerTask("tx-add-instruction", "Update developer comment in Transifex for a specific translation key", function () {
        setupTransifexConfig();

        function failAndPrintUsage(errorMessage) {
            var usageMessage = "Usage: " + grunt.task.current.nameArg +
                " --key=key.id --comment='New multiline comment<br/><br/>With <a href='http://www.google.com'>link to external instructions</a>'";
            failGruntTask(usageMessage, errorMessage);
        }

        var key = grunt.option("key");
        var comment = grunt.option("comment");

        if (!key) {
            failAndPrintUsage("No option key defined.");
        }

        if (!comment) {
            failAndPrintUsage("No option comment defined.");
        }

        grunt.log.writeln("Updating key " + key + " with comment " + comment + " in Transifex");
        var done = this.async();
        txUpdateInstruction(TX_MAIN_RESOURCE_SLUG, key, comment)
            .done(function onSuccess(result) {
                grunt.log.writeln(result);
                done(true);
            }, function onError(err) {
                grunt.log.writeln("Error: " + err);
                done(false);
            });
    });

    /*
     * Helper for sending POST request for creating new Resource in Transifex
     */
    function txCreateResource(name, slug, content) {

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resources/";

        var options = {
            uri: action,
            auth: TX_AUTH,
            header: { "Content-Type": "application/json" },
            json: {
                name: name,
                slug: slug,
                content: content,
                i18n_type: 'RESJSON'
            }
        };

        var deferred = q.defer();

        request.post(options, function (error, response, body) {
            if (!error && response.statusCode === 201) {
                deferred.resolve(body);
            } else {
                deferred.reject(body);
            }
        });
        return deferred.promise;
    }

    function txCreateLanguage(langCode) {

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/languages/";
        var langCoordinators = TX_COORDINATORS;
        var options = {
            uri: action,
            auth: TX_AUTH,
            header: { "Content-Type": "application/json" },
            json: {
                language_code: langCode,
                coordinators: langCoordinators
            }
        };

        var deferred = q.defer();

        request.post(options, function (error, response, body) {
            var result = { langCode: langCode, body: body };
            grunt.log.writeln("Status code " + response.statusCode);
            if (!error && response.statusCode === 201) {
                grunt.log.writeln("Created language", langCode, ":", body);
                deferred.resolve(result);
            } else {
                grunt.log.error("Error while creating language", langCode, ":", body);
                deferred.reject(result);
            }
        });

        return deferred.promise;
    }

    function txPushTranslation(resourceFile, resourceSlug, langCode) {

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resource/" + resourceSlug + "/translation/" + encodeURIComponent(langCode) + "/";
        var file = grunt.file.read(resourceFile);
        var jsonContent = rjson.parse(file);

        pruneEmptyTranslationStrings(jsonContent);
        pruneOrphanComments(jsonContent);
        var jsonString = JSON.stringify(jsonContent, null, 2);

        var txPayload = {
            content: jsonString,
            i18n_type: "RESJSON"
        };
        return txPutRequest(action, txPayload);
    }

    function txPushSingleTranslation(data) {
        var hash = generateSourceStringHash(data.key);
        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resource/" + data.resource +
            "/translation/" + data.lang + "/string/" + hash + "/";
        var txPayload = { translation: data.translation};
        return txPutRequest(action, txPayload);
    }

    /*
        Return list of resources with their lang codes, i.e.
        [ {lang: langcode, slug: slug} ...  ]
    */
    function txGetTranslatableResources(langCodeFilter) {

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/?details";
        var deferred = q.defer();
        request.get({
            url: action,
            auth: TX_AUTH
        }, function (error, response, body) {
            if (response && response.statusCode === 200) {
                var data = JSON.parse(body);
                var langs = data.teams.filter(function (lang) { return _.isEmpty(langCodeFilter) || _.contains(langCodeFilter, lang); });
                var resources = data.resources;
                var langsWithResources = [];
                langs.forEach(function (langCode) {
                    resources.forEach(function (r) {
                        langsWithResources.push({ lang: langCode, slug: r.slug });
                    });
                });
                deferred.resolve(langsWithResources);
            } else {
                grunt.log.error("Error while fetching project details");
                deferred.reject(body);
            }
        });
        return deferred.promise;
    }

    function txPullTranslation(resource) {
        var langCode = resource.lang;
        var resourceSlug = resource.slug;

        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resource/" + resourceSlug + "/translation/" + langCode + "/?file&mode=" + TX_TRANSLATION_MODE;
        var deferred = q.defer();
        request.get({
            url: action,
            auth: TX_AUTH
        }, function (error, response, body) {
            if (response && response.statusCode === 200) {
                grunt.log.writeln("Received " + langCode + " translation for resource " + resourceSlug);
                deferred.resolve({ langCode: langCode, resourceSlug: resourceSlug, translations: grunt.util.normalizelf(body) });
            } else {
                grunt.log.error("Error while accessing " + action + ": " + error);
                deferred.reject(error);
            }
        });
        return deferred.promise;
    }

    /*
        Call Transifex Resource API with PUT to update the resource content.
    */
    function txPushResource(resourceSlug) {
        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resource/" + resourceSlug + "/content";
        var resourceFile = SOURCE_LANG_STRINGS_PATH + "/" + resourceSlug + ".resjson";

        // read the resouce file and grab the JSON content
        var file = grunt.file.read(resourceFile);
        var jsonContent = rjson.parse(file);

        pruneEmptyTranslationStrings(jsonContent);
        pruneOrphanComments(jsonContent);

        var jsonString = JSON.stringify(jsonContent, null, 2);

        var txPayload = {
            content: jsonString,
            i18n_type: "RESJSON"
        };

        return txPutRequest(action, txPayload);
    }

    function txUpdateInstruction(resourceSlug, key, comment) {
        var stringHash = generateSourceStringHash(key);
        var action = TX_API + "/project/" + TX_PROJECT_SLUG + "/resource/" + resourceSlug + "/source/" + stringHash + "/";
        return txPutRequest(action, { comment: comment });
    }

    /*
        Helper for sending PUT requests with JSON payload to Transifex API
     */
    function txPutRequest(action, payload) {

        var opts = {
            uri: action,
            header: { "Content-Type": "application/json" },
            auth: TX_AUTH,
            json: payload
        };

        var deferred = q.defer();
        request.put(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                deferred.resolve(body);
                grunt.log.debug("Received 200 response from Transifex from " + action);
            } else {
                var errorMsg = "[" + response.statusCode + "]: " + response.body;
                grunt.log.debug("Error while accessing URL " + action);
                grunt.log.debug(errorMsg);
                deferred.reject(errorMsg);
            }
        });

        return deferred.promise;
    }

    /*
        Write translation resource file based on result from Transifex
        with standard comment at the top and proper BOM markers.
    */
    function createTranslationFile(result) {
        var mappedLangCode = mapFromTxLangCode(result.langCode);
        var path = STRINGS_PATH + "/" + mappedLangCode + "/" + result.resourceSlug + ".resjson";
        var commentPreamble = grunt.file.read(COMMENT_PREAMBLE_FILE);
        grunt.file.write(path, commentPreamble + grunt.util.linefeed + result.translations.replace(/^\ufeff/, ""));
        grunt.log.writeln("Wrote resource file for " + result.langCode + " to " + path);
    }

    function pruneEmptyTranslationStrings(jsonContent) {
        _.forEach(jsonContent, function (v, k) {
            if (_.isEmpty(v)) {
                grunt.log.verbose.warn("Removing comment key", k, "with empty value");
                delete jsonContent[k];
            }
        });
    }

    function pruneOrphanComments(jsonContent) {
        var keys = _.keys(jsonContent);
        _.forEach(jsonContent, function (v, k) {
            if (isComment(k)) {
                var matchingKey = getKeyForComment(k);
                if (!_.contains(keys, matchingKey)) {
                    grunt.log.verbose.warn("Removing the orphan comment key", k, "from the resource file upload");
                    delete jsonContent[k];
                }
            }
        });
    }

    /*
        Return language code understood by transifex, or
        undefined if the code isn't of correct format.
    */
    function mapToTxLangCode(str) {
        var matcher = str.match(/([a-z]{2})-([A-Z]{2}|latn)$/);
        if (matcher && matcher.length === 3) {
            if (matcher[2] === "latn") {
                return matcher[1] + "@latin";
            } else {
                return matcher[0].replace("-", "_");
            }
        } else {
            return undefined;
        }
    }

    /*
        Map Transifex language code back to language
        code used in the Windows project
    */
    function mapFromTxLangCode(str) {
        return str.replace("_", "-").replace("@", "-").replace("latin", "latn");
    }

    /*
        All RESJSON keys beginning with underscore (_) are treated as comments.
    */
    function isComment(str) {
        return !!str.match(/^_/);
    }

    function getKeyForComment(str) {
        return str.match(/^_(.*)\.comment$/)[1];
    }

    function isIgnoredResource(filename) {
        return _.contains(IGNORED_RESOURCES, filename);
    }

    function resourceFileExists(resource) {
        return grunt.file.isFile(SOURCE_LANG_STRINGS_PATH + "/" + resource + ".resjson");
    }

    /* 
        Helper for creating hash for a source string used by Transifex 
     
        For details, see http://support.transifex.com/customer/portal/articles/1026117#string-hashes
     */
    function generateSourceStringHash(translationKey) {
        return crypto.createHash("md5").update(translationKey + ":").digest("hex");
    }

    /*
       Read Transifex specific configs
    */
    function readConfigs(filePath) {
        var options = rjson.parse(grunt.file.read(filePath), {
            relaxed: true,
            warnings: true,
        });

        /* The expected keys that should be present in the config file */
        var requiredKeys = ["transifex.api", "transifex.auth.user", "transifex.auth.pass", "transifex.projectSlug",
        "transifex.langCoordinators", "transifex.mainResourceSlug", "transifex.sourceLanguage", "localProject.stringsPath",
        "localProject.sourceLangStringsPath", "localProject.commentPreambleFile"];
        var optionsKeys = flattenKeys(options);

        var missingProperties = requiredKeys.filter(function (k) { return !_.contains(optionsKeys, k); });
        if (!_.isEmpty(missingProperties)) {
            grunt.fatal("missing option(s) from the config file " + filePath + ": " + missingProperties.join(", "));
        }
        return options;
    }

    /*
        Utility function to generate a flattened array of keys of an object.
    */
    function flattenKeys(obj, list, namespace) {
        list = list || [];
        _.forEach(obj, function (v, k) {
            if (_.isObject(v) && !_.isArray(v)) {
                var nestedNs = (namespace ? namespace + "." + k : k);
                return flattenKeys(v, list, nestedNs);
            } else {
                list.push(namespace + "." + k);
            }
        });
        return list;
    }

    function failGruntTask(usageMessage, errorMessage) {
        grunt.log.writeln(usageMessage);
        grunt.fatal(errorMessage);
    }

    /*
        Return array of language codes of translations under STRINGS_PATH
    */
    function getTranslationCodes() {
        var translationCodes = [];
        grunt.file.recurse(STRINGS_PATH, function(abspath, rootdir, subdir, filename) {
            // treat any non-empty directories that can be mapped to a Transifex language code
            // as translation directories
            if (subdir && mapToTxLangCode(subdir) && TX_SOURCE_LANGUAGE !== mapToTxLangCode(subdir)) {                
                translationCodes.push(subdir);
            }
        });
        return _.uniq(translationCodes);
    }
};

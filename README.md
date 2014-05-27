# grunt-transifex-resjson

Grunt tasks for managing RESJSON resource files in [Transifex](https://www.transifex.com/). 

These tasks have been developed to interact with the Transifex API in a Windows Store Javascript app project where RESJSON resource files are used for handling different translations. 

See the [MSISDN](http://msdn.microsoft.com/en-us/library/windows/apps/hh465254.aspx) for details about using RESJSON in Javascript apps.

## Getting Started
This plugin requires Grunt `~0.4.3`

You may install this plugin with this command:

```shell
npm install grunt-transifex-resjson --save
```

Once the plugin has been installed, it may be enabled and configured inside your `Gruntfile.js`.

Enable the tasks:

```js
grunt.loadNpmTasks("grunt-transifex-resjson");
```

Define the configuration file name in `initConfig`:

```js
    grunt.initConfig({
    ...
        "transifex-resjson": {
            transifex_resjson_config: "project-tx-config-file.resjson"
        }
    ...
    }
```

Setup the configuration file as described in the following section.

### <span id="Configuration file">Configuration file</span>

The tasks provided in `grunt-transifex-resjson` read configuration information from a file located at the root of your Grunt project. The name  of the config file is defined in the `transifex_resjson_config` -property described above.

The config file contains your Transifex project info for accessing the [Transifex API](http://support.transifex.com/customer/portal/articles/995872-overview) and information regarding the local project file structure in order to locate the resources files. The configuration is defined in  [Relaxed JSON](http://oleg.fi/relaxed-json/) format, so comments are allowed. Below is a sample configuration file:

```js
{
  /*
      Settings for Transifex API credentials and Transifex project specific info.
  */
  transifex: {
    /*
        URL for the Transifex API
    */
    api: "https://www.transifex.com/api/2",

    /*
        Authentication information for the API
    */
    auth: {
      user: "yourtransifexuser",
      pass: "anditspassword",
    },

    projectSlug: "transifex-projectslug",

    /*
       List of Transifex users used as coordinators for languages created 
       using the tasks
    */
    langCoordinators: ["user1", "user2"],

    /*
       Source language code used in Transifex project. The language code
        is in Transifex format.
    */
    sourceLanguage: "en_US",
    /*
        Set which translations are downloaded from Transifex, only reviewed
        or all translations. Available modes are: `default` and `reviewed`.
        If not set, the `default` is used. Optional parameter.
        
        See: http://docs.transifex.com/developer/api/translations for
        details about the mode parameter.
    */
    translationMode: "reviewed",
  },

  },
  /*
     Settings for your local project 
  */
  localProject: {

    /*       
        Directory in your local project structure containing
        RESJSON files 
    */ 
    stringsPath: "src/strings",

    /*
        Directory containing the resource files containing the 
        source language strings
    */
    sourceLangStringsPath: "src/strings/en-US",

    /*
        Array of file names of resources in the `sourceLangStringsPath` that should be ignored by Transifex. Optional parameter.
    */
    ignoredResources: ["dev-resources.resjson"]
  }
}
```

### Provided Grunt Tasks and Usage

The `grunt-transifex-resjson` module provides the following Grunt tasks for interacting with your Transifex repository:

- [tx-project-resources](#tx-project-resources)
- [tx-pull-translations](#tx-pull-translations)
- [tx-push-resources](#tx-push-resources)
- [tx-create-translation-language](#tx-create-translation-language)
- [tx-add-resource](#tx-add-resource)
- [tx-push-translations](#tx-push-translations)
- [tx-push-translation-key](#tx-push-translation-key)
- [tx-add-instruction](#tx-add-instruction)

#### <span id="tx-project-resources">tx-project-resources</span>


##### Description

Returns a list of project resources from Transifex.


##### Usage

```js
grunt tx-project-resources
```

#### <span id="tx-create-translation-language">tx-create-translation-language</span>

##### Description

Add a new language for translation in Transifex project. Takes language code or the string `all` as argument. `all` tries to create a language for translation in Transifex for all languages found under the `stringsPath`.

The language codes used as arguments are those used in the local project as directory names, i.e. **not** Transifex language codes.

##### Usage

```js
grunt tx-create-translation-language:jp-JP 
```

Or provision all languages at once.

```js
grunt tx-create-translation-language:all
```



#### <span id="tx-add-resource">tx-add-resource</span>

##### Description

Creates a new resource in Transifex. The first parameter is used as the slug name in Transifex and a RESJSON file with the same name and extension `.resjson` is required to be found from the source language directory. Additionally a second parameter can be used to give the file a more descriptive name to be used in the Transifex UI, otherwise the slug name is used.

##### Usage

```js
grunt tx-add-resource:<basename-for-resource>:"Additional Display name in Transifex"
```

#### <span id="tx-push-resources">tx-push-resources</span>

##### Description

Pushes `*.resjson` resource files under the `sourceLangStringsPath` to Transifex project labeled with `projectSlug`.

The files are expected to be created in the Transifex project prior pushing.

##### Usage

```js
grunt tx-push-resources
```

#### <span id="tx-pull-translations">tx-pull-translations</span>

##### Description


Retrieves translations from Transifex project. The task can be given a list of language codes as argument to limit which translations are downloaded. If the configuration parameter `transifex.translationMode` is set to `reviewed`, only the translations marked as reviewed in Transifex are returned as translated and the non-reviewed strings are returned identical to the source language strings. Otherwise the default mode is used and all translations regardless of their review status are downloaded.

The language codes used as arguments are those used in the local project as directory names, i.e. **not** Transifex language codes.


##### Usage

```js
grunt tx-pull-translations
```

or to download specific translations:

```js
grunt tx-pull-translations:fi-FI,es-ES
```


#### <span id="tx-push-translations">tx-push-translations</span>

##### Description

Upload local translation files to Transifex. The task can be given a list of language codes as argument to limit which translations are uploaded.

The language codes used as arguments are those used in the local project as directory names, i.e. **not** Transifex language codes.

Any existing translations for the uploaded data are overwritten in Transifex in the process.

##### Usage


```js
grunt tx-push-translations
```

or to upload specific translations:

```js
grunt tx-push-translations:fi-FI,es-ES
```


#### <span id="tx-push-translation-key">tx-push-translation-key</span>

##### Description

Push translation for a single key of a single resource file for specified languages to Transifex. By default the key is updated for all languages. The resource without file-extension is specified as the first parameter, the key to update as second and optionally a comma separated list of language codes as the third parameter. 

The language codes used as parameters are those used in the local project as directory names, i.e. **not** Transifex language codes.

Any existing translations for the key in Transifex are overwritten in the process.

##### Usage

Upload the translations for all languages of the specified key `key.id` of resource `my-resource` to Transifex.

```js
grunt tx-push-translation-key:my-resource:key.id
```

Add the 3rd parameter to limit uploading the translations for only specified languages:

```js
grunt tx-push-translation-key:resource:key.id:fi-FI,es-ES
```

#### <span id="tx-add-instruction">tx-add-instruction</span>

##### Description

Includes detailed instructions in addition to the comments in resources file for translators for a translation key. The detailed instruction can include HTML markup for easier readability in Transifex. The detailed instruction is not part of the data read back from Transifex with `tx-pull-translations`.

##### Usage

```sh
grunt tx-add-instruction:resource-id:key.id:'<comment-str>'
```

e.g.

```sh
grunt tx-add-instruction:extra-resources:my.little.key.id:'<strong>Important!</strong> Comment can include HTML markup and <a href="http://www.google.com">links</a>'
```

## License

Licensed under the MIT license.

## Release History

0.1.0 Initial version.

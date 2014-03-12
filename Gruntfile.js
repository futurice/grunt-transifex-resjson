/*
 * grunt-transifex-resjson
 * -
 *
 * Copyright (c) 2014 Futurice Ltd, Vodafone Group
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({

    // Config file location for transifex-resjson
    "transifex-resjson": {

        transifex_resjson_config: "transifex-config.resjson",
    },
    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
      ],
      options: {
        jshintrc: '.jshintrc',
      },
    }
  });

  // Actually load this plugin's task(s).
  grunt.loadTasks('tasks');

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');

  // By default, lint.
  grunt.registerTask('default', ['jshint']);

};

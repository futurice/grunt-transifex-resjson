module.exports = function(grunt) {
        grunt.initConfig({
                "transifex-resjson": {
                        transifex_resjson_config: "transifex.rjson"
                }
        });
        grunt.loadNpmTasks("grunt-transifex-resjson");
};

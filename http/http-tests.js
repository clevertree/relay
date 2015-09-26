/**
 * Created by ari on 9/25/2015.
 */

if(!exports) var exports = {};
exports.test = function() {
    var tests = [
        require('./http-server-commands.js').test,
        require('./http-client-commands.js').test,
        //require('http-listeners').test,
        require('./http-db.js').test
    ];

    for(var i=0; i<tests.length; i++)
        setTimeout(tests[i], 1);
};
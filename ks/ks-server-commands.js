/**
 * Created by ari on 9/22/2015.
 */
if (!module) var module = {exports:{}};
module.exports.initSocketServerKSCommands = function(SocketServer) {

    // HTTP GET Command
    SocketServer.addCommand(importGETCommand);
    function importGETCommand(commandString, e) {
        if(!/^(get|http)/i.test(commandString))
            return false;
        SocketServer.removeCommand(importGETCommand);
        require('ks/get/ks-server-get-commands.js')
            .initSocketServerKSGetCommands(SocketServer);
        return false;
    }


    // HTTP PUT Command
    SocketServer.addCommand(importPUTCommand);
    function importPUTCommand(commandString, e) {
        if(!/^put/i.test(commandString))
            return false;
        SocketServer.removeCommand(importPUTCommand);
        require('ks/put/ks-server-put-commands.js')
            .initSocketServerKSPutCommands(SocketServer);
        return false;
    }


    // AUTH Command
    SocketServer.addCommand(importAUTHCommand);
    function importAUTHCommand(commandString, e) {
        if(!/^auth/i.test(commandString))
            return false;
        SocketServer.removeCommand(importAUTHCommand);
        require('ks/auth/ks-server-auth-commands.js')
            .initSocketServerAuthCommands(SocketServer);
        return false;
    }

};

module.exports.initHTTPServerKSCommands = function(HTTPServer) {

    // HTTP GET Command
    HTTPServer.addCommand(importGETCommand);
    function importGETCommand(commandString, e) {
        if(!/^(get|http)/i.test(commandString))
            return false;
        HTTPServer.removeCommand(importGETCommand);
        require('ks/get/ks-server-get-commands.js')
            .initHTTPServerKSGetCommands(HTTPServer);
        return false;
    }


    //// HTTP PUT Command
    //HTTPServer.addCommand(importPUTCommand);
    //function importPUTCommand(commandString, e) {
    //    if(!/^put/i.test(commandString))
    //        return false;
    //    HTTPServer.removeCommand(importPUTCommand);
    //    require('ks/put/ks-server-put-commands.js')
    //        .initHTTPServerKSPutCommands(HTTPServer);
    //    return false;
    //}

};

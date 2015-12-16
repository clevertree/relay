/**
 * Created by ari on 9/22/2015.
 */
if(typeof module === 'object') (function() {
    module.exports.initSocketServerKSCommands = function (SocketServer) {

        // HTTP GET Command
        SocketServer.addCommand(importGETCommand);
        function importGETCommand(commandString, e) {
            if (!/^(?:keyspace\.)?(get|http)/i.test(commandString))
                return false;
            SocketServer.removeCommand(importGETCommand);
            require('./get/ks-server-get-commands.js')
                .initSocketServerKSGetCommands(SocketServer);
            return false;
        }


        // HTTP PUT Command
        SocketServer.addCommand(importPUTCommand);
        function importPUTCommand(commandString, e) {
            if (!/^(?:keyspace\.)?put/i.test(commandString))
                return false;
            SocketServer.removeCommand(importPUTCommand);
            require('./put/ks-server-put-commands.js')
                .initSocketServerKSPutCommands(SocketServer);
            return false;
        }


        // AUTH Command
        SocketServer.addCommand(importHostCommand);
        function importHostCommand(commandString, e) {
            if (!/^(?:keyspace\.)?host/i.test(commandString))
                return false;
            SocketServer.removeCommand(importHostCommand);
            require('./host/ks-server-host-commands.js')
                .initSocketServerHostCommands(SocketServer);
            return false;
        }

        // TODO: Search here
        // KEYSPACE.CONTACTS Command
        SocketServer.addCommand(importContactsCommand);
        function importContactsCommand(commandString, e) {
            if (!/^(?:keyspace\.)?contacts/i.test(commandString))
                return false;
            SocketServer.removeCommand(importContactsCommand);
            require('./contacts/ks-server-contacts-commands.js')
                .initSocketServerContactsCommands(SocketServer);
            return false;
        }

    };

    module.exports.initHTTPServerKSCommands = function (HTTPServer) {

        // HTTP GET Command
        HTTPServer.addCommand(importGETCommand);
        function importGETCommand(commandString, e) {
            if (!/^(get|http)/i.test(commandString))
                return false;
            HTTPServer.removeCommand(importGETCommand);
            require('./get/ks-server-get-commands.js')
                .initHTTPServerKSGetCommands(HTTPServer);
            return false;
        }


        //// HTTP PUT Command
        //HTTPServer.addCommand(importPUTCommand);
        //function importPUTCommand(commandString, e) {
        //    if(!/^put/i.test(commandString))
        //        return false;
        //    HTTPServer.removeCommand(importPUTCommand);
        //    require('keyspace/put/ks-server-put-commands.js')
        //        .initHTTPServerKSPutCommands(HTTPServer);
        //    return false;
        //}

    };
})();
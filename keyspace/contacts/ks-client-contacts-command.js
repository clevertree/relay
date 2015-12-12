/**
 * Ari 7/2/2015.
 */
if(typeof module === 'object') (function() {
    module.exports.initClientPGPContactCommand = function (ClientWorker) {
        ClientWorker.addCommand(contactCommand);
        ClientWorker.addResponse(eventListener, true);

        var refreshTimeout = null;
        function eventListener(responseString) {
            var match = /^event (keyspace\.host|keyspace\.insert|settings\.update)/i.exec(responseString);
            if (match) {
                if(refreshTimeout)
                    clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(function() {
//                     console.info("Refreshing Contact List: " + responseString);
                    contactCommand("KEYSPACE.CONTACTS.REFRESH");
                }, 500);
            }

            return false;
        }

        var activeContactList = null;
        function contactCommand(commandString) {
            var match = /^keyspace\.contact(\.refresh)?/i.exec(commandString);
            if (!match)
                return false;

            self.module = {exports: {}};
            importScripts('keyspace/contacts/render/ks-contact-list.js');
            var templateExports = self.module.exports;

            templateExports.renderPGPContactList(function (html) {
                ClientWorker.render(html);
            });

            if(activeContactList === null) {
                console.log("Requesting contact list status");
                activeContactList = [];
                // Query public keys
                var path = 'public/id';
                KeySpaceDB.queryAll(path, function(err, contentEntry) {
                    if (err)
                        throw new Error(err);

                    if (contentEntry) {
                        activeContactList.push(contentEntry.pgp_id_public);

                    } else {
                        ClientWorker.sendWithSocket("KEYSPACE.HOST.SUBSCRIBE " + activeContactList.join(" "));
                    }
                });
            }

            return true;
        }

    };
})();
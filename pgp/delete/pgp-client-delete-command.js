/**
 * Ari 7/2/2015.
 */
if(typeof module === 'object') (function() {
    module.exports.initClientPGPDeleteCommand = function (ClientWorkerThread) {
        ClientWorkerThread.addCommand(deleteCommand);



        /**
         * @param commandString DELETE [PGP Private Key ID]
         */
        function deleteCommand(commandString, e) {
            var match = /^pgp.delete\s+(.*)$/im.exec(commandString);
            if (!match)
                return false;

            self.module = {exports: {}};
            importScripts('keyspace/ks-db.js');
            var KeySpaceDB = self.module.exports.KeySpaceDB;

            var publicKeyIDs = match[1].trim().split(/\W+/g);
            for (var i = 0; i < publicKeyIDs.length; i++) {
                (function (publicKeyID) {
                    publicKeyID = publicKeyID.substr(publicKeyID.length - KeySpaceDB.DB_PGP_KEY_LENGTH);

                    // Query public key(s)
                    var privateKeyPath = 'http://' + publicKeyID + '.ks/public/id';
                    KeySpaceDB.queryOne(privateKeyPath, function (err, privateKeyData) {
                        if (err)
                            throw new Error(err);
                        if (privateKeyData) {
                            KeySpaceDB.deleteContent(privateKeyData.pgp_id_public, privateKeyData.timestamp, function (err) {
                                if (err)
                                    throw new Error(err);
                                console.info("PGP Public Key deleted successfully: " + privateKeyData.user_id);

                                var status_box = "<span class='success'>PGP Public Key <br/>deleted successfully</span>: " + privateKeyData.user_id + "<br/>Public Key ID: " + publicKeyID;

                                self.module = {exports: {}};
                                importScripts('pgp/manage/render/pgp-manage-form.js');
                                self.module.exports.renderPGPManageForm(status_box, function (html) {
                                    ClientWorkerThread.render(html);
                                });
                            });
                        }

                        // Query private key(s)
                        var privateKeyPath = 'http://' + publicKeyID + '.ks/.private/id';
                        KeySpaceDB.queryOne(privateKeyPath, function (err, privateKeyData) {
                            if (err)
                                throw new Error(err);
                            if (privateKeyData) {
                                KeySpaceDB.deleteContent(privateKeyData.pgp_id_public, privateKeyData.timestamp, function (err) {
                                    if (err)
                                        throw new Error(err);
                                    console.info("PGP Public/Private KeyPair deleted successfully: " + privateKeyData.user_id);

                                    var status_box = "<span class='success'>PGP Public/Private KeyPair <br/>deleted successfully</span>: " + privateKeyData.user_id + "<br/>Public Key ID: " + publicKeyID;

                                    self.module = {exports: {}};
                                    importScripts('pgp/manage/render/pgp-manage-form.js');
                                    self.module.exports.renderPGPManageForm(status_box, function (html) {
                                        ClientWorkerThread.render(html);
                                    });
                                });
                            //} else {
                            //    console.error("Not found: " + publicKeyID);
                            }
                        });
                    });
                })(publicKeyIDs[i]);
            }
            return true;
        }

    };
})();
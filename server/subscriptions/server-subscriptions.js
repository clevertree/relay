/**
 * Created by ari on 12/17/2015.
 *
 * Provides a memory-based subscription database for active user subscriptions.
 * Other modules use this class to query and keep track of subscriptions in real-time
 */

// Enable Strict mode
"use strict";

// Declare export module, if not found
if (!module) var module = {exports: {}};

// Declare self as a variable if it doesn't already exist
if (typeof self === 'undefined')
    var self = this;

// Export ServerSubscriptions Class. Define it if it hasn't
module.exports.ServerSubscriptions =
    typeof self.ServerSubscriptions !== 'undefined' ? self.ServerSubscriptions : self.ServerSubscriptions =
(function() {
    // ServerSubscriptions has not been defined yet, so let's define it
    function ServerSubscriptions() {

    }

    // Default Subscription Mode
    var DEFAULT_MODE = 'event';

    // KeySpace Subscription Object
    var keyspaceSubscriptions = {};

    // KeySpace Status Object
    var keyspaceStatus = {};

    // Channel Subscription Object
    var channelSubscriptions = {};


    /**
     * @param subscriptionString
     * @param client
     * @returns string if an old subscription exists for this client
     * @example CHANNEL.SUBSCRIBE.CHAT /state/az guest123
     * @example KEYSPACE.SUBSCRIBE.GET ABCD1234 ABCD1234 <-- host keyspace content
     * @example KEYSPACE.SUBSCRIBE.PUT ABCD1234 ABCD1234 <-- host keyspace service
     */
    ServerSubscriptions.handleClientSubscription = function(subscriptionString, client) {
        var match = /^(\w+)\.(|un|re)subscribe(?:\.(\S+))?\s+(\S+)\s*([\s\S]*)$/im.exec(subscriptionString);
        if (!match)
            throw new Error("Invalid Subscription: " + subscriptionString);


        // New Subscription was matched correctly, so let's handle it
        var type = match[1].toLowerCase();
        var prefix = match[2].toLowerCase();
        var modeString = (match[3] || DEFAULT_MODE);
        var mode = modeString.toLowerCase();
        var argString = match[5];

        var subMode = null;
        if(mode.indexOf('.') > 0) {
            var modeSplit = modeString.split('.');
            mode = modeSplit.shift();
            subMode = modeSplit.join('.');
        }


        var subscriptionListItem = null;
        var subscriptionList = null;
        var modeList;
        var clientList;
        switch(type) {
            case 'keyspaces':
                var kss = [], ksplit = [];
                argString = match[4] + (argString ? ' ' + argString : '');
                ksplit = argString.split(/\s+/g);
                for(var kspliti=0; kspliti<ksplit.length; kspliti++)
                    if(ksplit[kspliti].length > 0)
                        kss.push(
                            ServerSubscriptions.handleClientSubscription(
                                'KEYSPACE.' +
                                prefix.toUpperCase() + 'SUBSCRIBE.' + modeString.toUpperCase() +
                                ' ' + ksplit[kspliti],
                                client
                            )
                        );

                return ksplit;

            case 'keyspace':

                // This is a keyspace subscription, so the first arg is the PGP Public Key ID
                var pgp_id_public = match[4].toUpperCase();
                var id_match = /^(?:([A-F0-9]{8,})\s*)+$/i.exec(pgp_id_public);
                if(!id_match)
                    throw new Error("Invalid PGP Public ID Key: " + pgp_id_public);

                if(typeof keyspaceSubscriptions[pgp_id_public] === 'undefined')
                    keyspaceSubscriptions[pgp_id_public] = {};
                modeList = keyspaceSubscriptions[pgp_id_public];

                // Authentication may be required for certain (or all) subscriptions. Unauth-ed subscriptions still get
                switch (mode) {
                    case 'post':    // Auth required for handling POST requests from clients
                    case 'put':     // Auth required for PUT new content? Yes. Nothing should be PUT online without consent.
                        ServerSubscriptions.requestKeySpaceAuthentication(pgp_id_public, client, function() {
                            ServerSubscriptions.notifyAllAuthenticatedKeySpaceClients(pgp_id_public, "EVENT " + subscriptionString);
                        });
                        break;

                    case 'get':     // No auth required for GET. all GET requests are verified on the client (keyspace)
                        break;

                    case 'event':   // No auth for status subscription
                        var keyspaceStatusString = ServerSubscriptions
                            .getKeySpaceStatus(pgp_id_public);
                        var keyspaceStatus = keyspaceStatusString
                            .split(' ')[0]
                            .toLowerCase();
                        if(keyspaceStatus !== 'offline' && prefix === '') {
                            // Notify subscriber of keyspace status
                            send(client, "KEYSPACE.STATUS " + keyspaceStatusString + " " + pgp_id_public);
                        }
                        break;
                    default:
                        throw new Error("Invalid KeySpace Mode: " + subscriptionString);
                }

                // TODO: notify client of status content i.e. userlist, online/offline

                // If this mode hasn't been defined yet, lets create the array
                if(typeof modeList[mode] === 'undefined')
                    modeList[mode] = [];

                // Set this mode list as the list to be modified
                clientList = modeList[mode];

                if(typeof client.keyspaces === 'undefined')
                    client.keyspaces = [];
                subscriptionList = client.keyspaces;
                subscriptionListItem = pgp_id_public;
                break;


            case 'channels':
                // TODO: username for all channels?
                var css = [], csplit = [];
                argString = match[4] + (argString ? ' ' + argString : '');
                csplit = argString.split(/\s+/g);
                console.log("Multiple subscribe: ", csplit);
                for(var cspliti=0; cspliti<csplit.length; cspliti++)
                    if(csplit[cspliti].length > 0)
                        css.push(
                            ServerSubscriptions.handleClientSubscription(
                                'CHANNEL.' + prefix.toUpperCase() + 'SUBSCRIBE.' + modeString.toUpperCase() +
                                ' ' + csplit[cspliti],
                                client
                            )
                        );

                return csplit;

            case 'channel':

                // This is a channel subscription, so the first arg is the Channel Name
                var channel = match[4].toLowerCase();
                if(typeof channelSubscriptions[channel] === 'undefined')
                    channelSubscriptions[channel] = {};
                modeList = channelSubscriptions[channel];
                switch (mode) {
                    case 'event':
                    case 'chat':
                    case 'audio':
                    case 'video':
                        // If this mode hasn't been defined yet, lets create the array
                        if(typeof modeList[mode] === 'undefined')
                            modeList[mode] = [];

                        // Set this mode list as the list to be modified
                        clientList = modeList[mode];
                        break;
                    default:
                        throw new Error("Invalid Channel Mode: " + subscriptionString);
                }

                if(typeof client.channels === 'undefined')
                    client.channels = [];
                subscriptionList = client.channels;
                subscriptionListItem = channel;
                break;

            default:
                throw new Error("Invalid Subscription Type: " + subscriptionString);
        }

        var oldPos = -1;
        var oldSubscriptionString = null;
        // Find the old subscription matching this client for the specified list
        for(var i=0; i<clientList.length; i++) {
            if(!clientList[i] || !clientList[i][0])
                throw new Error("Invalid Client Entry: " + i);
            // If the client matches, grab the old subscription string
            if(clientList[i][0] === client){
                oldPos = i;
                oldSubscriptionString = clientList[i][1];
                break;
            }
        }

        var listPos = subscriptionList.indexOf(subscriptionListItem);

        if(prefix === 'un') {       // If Unsubscribe,
            if(oldPos === -1)
                throw new Error("Old Subscription not found: " + subscriptionString);
            // Delete the subscription
            clientList.splice(oldPos, 1);
            //delete clientList[oldPos];
            console.log(type + " subscription removed: ", subscriptionString);

            if(listPos >= 0)
                subscriptionList.splice(listPos, 1);
            else
                console.warn("Removed Subscription List Item not found in client list: " + subscriptionListItem);

        } else if(prefix === 're') { // If ReSubscribe,
            if(oldPos === -1)
                throw new Error("Old Subscription not found: " + subscriptionString);
            // Replace the old subscription
            clientList[oldPos] = [client, argString];
            console.log(type + " subscription replaced: ", subscriptionString);

            if(listPos === -1)
                console.warn("Existing Subscription List Item not found in client list: " + subscriptionListItem + "\nUnfinished RE logic?");

        } else {
            if(oldPos === -1) {
                // Add the subscription
                clientList.push([client, argString]);

                if(listPos === -1)
                    subscriptionList.push(subscriptionListItem);
                else
                    console.warn("Added Subscription List Item already in client list: " + subscriptionListItem);

            } else {
                // Replace the subscription
                clientList[oldPos] = [client, argString];
                console.warn(type + " subscription replaced: ", subscriptionString);
            }
        }

        //send(client, subscriptionString);

        // Return the old subscription, if found
        return oldSubscriptionString;
    };

    /**
     * Search through all KeySpace subscriptions
     * @param searchClient optionally match subscriptions by client
     * @param searchMode optionally match subscriptions by mode
     * @param searchPublicKeyID optionally match subscriptions by Public Key ID
     * @param callback matched entries are returned through this callback
     * @returns {number} number of matched KeySpace entries
     */
    ServerSubscriptions.searchKeySpaceSubscriptions = function(searchClient, searchMode, searchPublicKeyID, callback) {
        if(searchMode)          searchMode = searchMode.toLowerCase();
        if(searchPublicKeyID) searchPublicKeyID = searchPublicKeyID.toUpperCase();

        // Matched subscription counter
        var count = 0;

        // Loop through all channels
        for(var pgp_id_public in keyspaceSubscriptions) {
            if(keyspaceSubscriptions.hasOwnProperty(pgp_id_public)) {
                // Optionally match the pgp id
                if(searchPublicKeyID && pgp_id_public === searchPublicKeyID)
                    continue;

                // Grab the keyspace mode list
                var modeList = keyspaceSubscriptions[pgp_id_public];

                // Loop through all modes in each keyspace
                for(var mode in modeList) {
                    if(modeList.hasOwnProperty(mode)) {
                        // Optionally match the channel subscription mode
                        if(searchMode && searchMode !== mode)
                            continue;

                        // Grab the channel/mode client list
                        var clientList = modeList[mode];

                        // Loop through all clients in the channel/mode
                        for(var i=0; i<clientList.length; i++) {
                            var subscriberClient = clientList[i][0];
                            if(subscriberClient.readyState !== subscriberClient.OPEN) {
                                clientList.splice(i--, 1);
                                continue;
                            }
                            var ret = callback(subscriberClient, mode, pgp_id_public, clientList[i][1]);
                            // Count the matched subscription
                            count++;

                            // If true was returned by the callback, end the search here
                            if(ret === true)
                                return count;
                        }
                    }
                }
            }
        }

        // Return the matched subscriptions
        return count;
    };

    /**
     * Returns a list of subscriptions for a specific keyspace/mode
     * @param pgp_id_public
     * @param mode
     * @returns {*}
     */
    ServerSubscriptions.getKeySpaceSubscriptions = function(pgp_id_public, mode) {
        if(mode)          mode = mode.toLowerCase();
        if(pgp_id_public) pgp_id_public = pgp_id_public.toUpperCase();
        if(typeof keyspaceSubscriptions[pgp_id_public] === 'undefined')
            return [];
        var modeList = keyspaceSubscriptions[pgp_id_public];
        if(typeof modeList[mode] === 'undefined')
            return [];
        return modeList[mode].slice();
    };

    /**
     * Returns the Subscription ArgString for a client, if found
     * @param client subscriber client
     * @param channel subscribed channel
     * @param mode subscription mode
     */
    ServerSubscriptions.getClientChannelArgString = function(client, channel, mode) {
        var clientList = ServerSubscriptions.getChannelSubscriptions(channel, mode);
        for(var i=0; i<clientList.length; i++) {
            if(clientList[i][0] === client) {   // If client matches
                return clientList[i][1];        // Return the Subscription ArgString
            }
        }
        return null;
    };

    /**
     * Returns a list of subscriptions for a specific channel/mode
     * @param channel
     * @param mode
     * @returns {*}
     */
    ServerSubscriptions.getChannelSubscriptions = function(channel, mode) {
        if(mode)          mode = mode.toLowerCase();
        if(channel) channel = channel.toLowerCase();
        if(typeof channelSubscriptions[channel] === 'undefined')
            return [];
        var modeList = channelSubscriptions[channel];
        if(typeof modeList[mode] === 'undefined')
            return [];
        return modeList[mode].slice();
    };

    /**
     * Search through all Channel subscriptions
     * @param searchClient optionally match subscriptions by client
     * @param searchMode optionally match subscriptions by mode
     * @param searchChannelPrefix optionally match subscriptions by channel prefix
     * @param callback matched entries are returned through this callback
     * @returns {number} number of matched Channel entries
     */
    ServerSubscriptions.searchChannelSubscriptions = function(searchClient, searchChannelPrefix, searchMode, callback) {
        if(searchMode)          searchMode = searchMode.toLowerCase();                      // Modes are lowercase
        if(searchChannelPrefix) searchChannelPrefix = searchChannelPrefix.toLowerCase();    // Channels are lowercase

        // Matched subscription counter
        var count = 0;

        // Loop through all channels
        for(var channel in channelSubscriptions) {
            if(channelSubscriptions.hasOwnProperty(channel)) {
                // Optionally match the channel prefix
                if(searchChannelPrefix && channel.indexOf(searchChannelPrefix) !== 0)
                    continue;

                // Grab the channel mode list
                var modeList = channelSubscriptions[channel];

                // Loop through all modes in each channel
                for(var mode in modeList) {
                    if(modeList.hasOwnProperty(mode)) {
                        // Optionally match the channel subscription mode
                        if(searchMode && searchMode !== mode)
                            continue;

                        // Grab the channel/mode client list
                        var clientList = modeList[mode];

                        // Loop through all clients in the channel/mode
                        for(var i=0; i<clientList.length; i++) {
                            if(!clientList[i] || !clientList[i][0])
                                throw new Error("Invalid Client Entry: " + i);

                            var client = clientList[i][0];
                            if(searchClient && searchClient !== client)
                                continue;

                            var ret = callback(client, channel, mode, clientList[i][1]);

                            // Count the matched subscription
                            count++;

                            // If true was returned by the callback, end the search here
                            if(ret === true)
                                return count;
                        }
                    }
                }
            }
        }

        // Return the matched subscriptions
        return count;
    };


    /** KeySpace Methods **/

    var keyspaceAuthentications = {};
    var keyspaceUserIDs = {};
    var keyspaceChallenges = {};
    //var keyspaceRequests = {};

    ServerSubscriptions.getAuthenticatedKeySpaceClients = function(pgp_id_public) {
        pgp_id_public = pgp_id_public.toUpperCase();
        if(typeof keyspaceAuthentications[pgp_id_public] === 'undefined')
            return [];

        var clientList = keyspaceAuthentications[pgp_id_public];
        for(var i=0; i<clientList.length; i++) {
            if(clientList[i].readyState !== clientList[i].OPEN) {
                clientList.splice(i--, 1);
                console.warn("Removing Disconnected Client (" + clientList.length + "): " + pgp_id_public);
            }
        }
        return clientList.slice();
    };

    ServerSubscriptions.isKeySpaceAuthorized = function(pgp_id_public, client) {
        var clients = ServerSubscriptions.getAuthenticatedKeySpaceClients(pgp_id_public);
        if(client)
            return clients.indexOf(client) >= 0;
        return clients.length > 0;
    };

    ServerSubscriptions.getAuthenticatedKeySpaceUserID = function(pgp_id_public) {
        pgp_id_public = pgp_id_public.toUpperCase();
        if(typeof keyspaceUserIDs[pgp_id_public] === 'undefined')
            return null;
        return keyspaceUserIDs[pgp_id_public];
    };

    ServerSubscriptions.notifyAllAuthenticatedKeySpaceClients = function(pgp_id_public, commandString) {
        pgp_id_public = pgp_id_public.toUpperCase();
        if(typeof keyspaceAuthentications[pgp_id_public] !== 'undefined') {
            var clients = keyspaceAuthentications[pgp_id_public];
            for(var j=0; j<clients.length; j++) {
                if(clients[j].readyState !== clients[j].OPEN) {
                    clients.splice(j--, 1);
                    continue;
                }
                clients[j].send(commandString);
            }

            console.info("O" + clients.length + " " + commandString);
        }
    };

    ServerSubscriptions.handleKeySpaceAuthenticationCommand = function(commandString, client) {
        var match = /^keyspaces?\.auth\.(validate)\s+([\s\S]+)$/i.exec(commandString);
        if (!match)
            throw new Error("Invalid Authentication Command: " + commandString);

        var subCommand = match[1].toLowerCase();
        var hostCodes = match[2].split(/\s+/m);

        for(var i=0; i<hostCodes.length; i++) {
            var hostCode = hostCodes[i];

            if(typeof keyspaceChallenges[hostCode] === 'undefined') {
                send(client, "ERROR Host Code not found: " + hostCode);
                console.warn("Host Code not found: " + hostCode);
                continue;
            }

            var pgp_id_public = keyspaceChallenges[hostCode][0];
            var challengeClient = keyspaceChallenges[hostCode][1];
            var callback = keyspaceChallenges[hostCode][2];

            if(challengeClient !== client){
                send(client, "ERROR Client Mismatch: " + hostCode);
                throw new Error("ERROR Client Mismatch: " + hostCode);
            }
            //delete keySpaceChallenges[hostCode];

            if(typeof keyspaceAuthentications[pgp_id_public] === 'undefined')
                keyspaceAuthentications[pgp_id_public] = [];
            var authList = keyspaceAuthentications[pgp_id_public];
            if(authList.indexOf(client) >= 0) {
                send(client, "ERROR Client already authenticated: " + pgp_id_public);
                console.warn("Client already authenticated: " + pgp_id_public);
                continue;
            }

            authList.push(client);
            send(client, "KEYSPACE.AUTH.SUCCESS " + pgp_id_public);

            if(callback)
                callback(pgp_id_public, client);

            ServerSubscriptions.notifyAllAuthenticatedKeySpaceClients(pgp_id_public,
                "EVENT KEYSPACE.AUTH.SUCCESS " + pgp_id_public);
        }
    };

    ServerSubscriptions.requestKeySpaceAuthentication = function(pgp_id_public, client, callback) {
  
        pgp_id_public = pgp_id_public.toUpperCase();
        if(typeof keyspaceAuthentications[pgp_id_public] !== 'undefined') {
            if(keyspaceAuthentications[pgp_id_public].indexOf(client) >= 0) {
                if(callback) try {
                    callback(pgp_id_public, client);
                    console.info("Client reusing existing Keyspace authentication: ", pgp_id_public);
                    return true;
                } catch (e) {
                    console.error("Error requesting authentication: ", e);
                }
            }
        }

        console.info("Client requesting Keyspace authentication: ", pgp_id_public);
        ServerSubscriptions.requestClientPublicKey(pgp_id_public, client,
            function(err, publicKey) {

                if(err) {
                    send(client, "ERROR " + err);
                    console.error("Error requesting public key: " + err);
                    return;
                }

                // Generate new challenge
                var hostCode = generateUID('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx');

                if(typeof keyspaceChallenges[hostCode] !== 'undefined')
                    throw new Error("Host Code already exists: " + hostCode);

                keyspaceChallenges[hostCode] = [pgp_id_public, client, callback];

                if(typeof openpgp === 'undefined')
                    var openpgp = require('openpgp');

                openpgp.encryptMessage(publicKey, hostCode)
                    .then(function(encryptedMessage) {
                        console.info("Sending KeySpace Auth Challenge...");
                        send(client, "KEYSPACE.AUTH.CHALLENGE " + encryptedMessage);
                        //ServerSubscriptions.notifyAllAuthenticatedKeySpaceClients(pgp_id_public, "EVENT KEYSPACE.HOST.CHALLENGE " + encryptedMessage);

                    }).catch(function(error) {
                        send(client, "ERROR " + error);
                        console.error("Error encrypting KeySpace Auth Challenge: " + err);
                    });
            }
        );
    };

    ServerSubscriptions.requestClientPublicKey = function (pgp_id_public, client, callback) {
        pgp_id_public = pgp_id_public.toUpperCase();

        var requestString = "GET http://" + pgp_id_public + ".ks/public/id";

        var KeySpaceDB = require('../../keyspace/ks-db.js')
            .KeySpaceDB;

        console.info("Checking for local cache of Private Key: " + requestString);
        KeySpaceDB.executeLocalGETRequest(requestString,
            function(responseBody, responseCode, responseMessage, responseHeaders) {
                if(responseCode === 200) {
                    console.info("Public Key found locally: " + requestString);
                    parseResponse(responseBody, responseCode, responseMessage, responseHeaders);

                } else {
                    console.info("Requesting Public Key from Client: " + requestString);
                    ServerSubscriptions.requestKeySpaceContentFromSubscribedHosts(
                        KeySpaceDB,
                        requestString,
                        [client],
                        parseResponse
                    );

                }
            }
        );

        function parseResponse(responseBody, responseCode, responseMessage, responseHeaders, respondingClient) {

            if(responseCode !== 200) {
                callback(responseCode + " " + responseMessage, responseCode, responseMessage, '');
                return send(client, "ERROR " + responseCode + " " + responseMessage);
            }

            // No mismatch, key can come from cache or anywhere. respondingClient might be null dude
            //if(respondingClient && respondingClient !== client) { // TODO: Necessary?
            //    callback("Client Mismatch", 400, "Client Mismatch", '');
            //    return send(client, "ERROR Client Mismatch");
            //}

            var KeySpaceDB = require('../../keyspace/ks-db.js')
                .KeySpaceDB;
            if(typeof openpgp === 'undefined')
                var openpgp = require('openpgp');

            var publicKey = openpgp.key.readArmored(responseBody).keys[0];
            //var publicKeyCreateDate = publicKey.subKeys[0].subKey.created;
            //var privateKeyID = publicKey.primaryKey.getKeyId().toHex().toUpperCase();
            var publicKeyID = publicKey.subKeys[0].subKey.getKeyId().toHex().toUpperCase();
            publicKeyID = publicKeyID.substr(publicKeyID.length - KeySpaceDB.DB_PGP_KEY_LENGTH);
            if(publicKeyID !== pgp_id_public){
                callback("Public Key ID mismatch: " + publicKeyID + " !== " + pgp_id_public);
                return send(client, "ERROR Public Key ID mismatch: " + publicKeyID + " !== " + pgp_id_public);
            }

            var user_id = publicKey.getUserIds()[0] + '';
            keyspaceUserIDs[pgp_id_public] = user_id;

            callback(null, publicKey);
        }
    };

    ServerSubscriptions.handleKeySpaceStatusCommand = function(commandString, client) {
        var match = /^keyspaces?\.status\s+(\S{2,256})\s+([a-f0-9 ]+)$/i.exec(commandString);
        if (!match)
            throw new Error("Invalid Status Command: " + commandString);

        var statusValue = match[1];
        var statusCommand = statusValue.split('.')[0].toLowerCase();
        var all_pgp_id_public = match[2].split(/\s+/g);

        for(var i=0; i<all_pgp_id_public.length; i++) {
            var pgp_id_public = all_pgp_id_public[i];
            pgp_id_public = pgp_id_public.toUpperCase().substr(pgp_id_public.length - 8);

            switch(statusCommand) {
                case 'online':
                case 'offline':
                case 'away':
                    break;
                default:
                    break;
            }

            ServerSubscriptions.requestKeySpaceAuthentication(pgp_id_public, client,
                function(pgp_id_public, authClient) {

                    var oldStatus = null;
                    if(typeof keyspaceStatus[pgp_id_public] !== 'undefined')
                        oldStatus = keyspaceStatus[pgp_id_public];

                    keyspaceStatus[pgp_id_public] = statusValue;

                    var notifyCommandString = "KEYSPACE.STATUS " + statusValue + " " + all_pgp_id_public.join(" ");

                    // notify keyspace status subscribers yo{
                    var count = 0;
                    ServerSubscriptions.searchKeySpaceSubscriptions(null, 'event', null,
                        function(subscriberClient, mode, pgp_id_public, subscriberArgString) {
                            subscriberClient.send(notifyCommandString);
                            count++;
                        }
                    );

                    console.info("O" + count + " " + notifyCommandString);
                }
            );
        }

        return true;
    };

    ServerSubscriptions.getKeySpaceStatus = function(pgp_id_public) {
        pgp_id_public = pgp_id_public.toUpperCase().substr(pgp_id_public.length - 8);

        if(typeof keyspaceStatus[pgp_id_public] === 'undefined')
            return 'offline';

        // Verify clients are online;
        var keyspaceClients = ServerSubscriptions.getAuthenticatedKeySpaceClients(pgp_id_public);

        if(keyspaceClients.length === 0)
            return 'disconnected';

        return keyspaceStatus[pgp_id_public];
    };

    ServerSubscriptions.requestKeySpaceContentFromClient = function(KeySpaceDB, requestURL, callback) {
        // TODO:
    };

    ServerSubscriptions.requestKeySpaceContentFromSubscribedHosts = function(KeySpaceDB, requestString, additionalClients, callback) {
        var headerLines = requestString.split(/\n/g);
        var firstLine = headerLines.shift();
        var requestHeaders = headerLines.join("\n");
        var match = /^(head|get)\s+(\S+)/i.exec(requestString);
        if (!match)
            throw new Error("Invalid Socket GET/HEAD Request: " + requestString);

        var requestType = match[1].toLowerCase();
        var requestURL = match[2];

        match = /^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\\?([^#]*))?(#(.*))?/.exec(requestURL);
        if(!match)
            throw new Error("Invalid URI: " + requestString);

        var scheme = match[2],
            host = match[4],
            contentPath = (match[5] || '').toLowerCase() ;

        match = /^([^.]*\.)?([a-f0-9]{8,16})\.ks$/i.exec(host);
        if (!match)
            throw new Error("Host must match [PGP KEY ID (8 or 16)].ks: " + requestString);
        var pgp_id_public = match[2].toUpperCase();
        pgp_id_public = pgp_id_public.substr(pgp_id_public.length - KeySpaceDB.DB_PGP_KEY_LENGTH);


        // No local content found, so query each host client with a HEAD to see who might have it
        requestString = "HEAD " + requestURL + (requestHeaders ? "\n" + requestHeaders : "");

        var hostClients = ServerSubscriptions.getKeySpaceSubscriptions(pgp_id_public, "GET");
        if(hostClients.length <=2) // Hack: Adding authenticated clients also
            hostClients = hostClients.concat(ServerSubscriptions.getAuthenticatedKeySpaceClients(pgp_id_public));
        for(var i=0; i<hostClients.length; i++) {
            if(hostClients[i].readyState !== hostClients[i].OPEN) {
                hostClients.splice(i--, 1);
                //} else {
                //hostClients[i].send(requestString);
            }
        }

        if(additionalClients)
            hostClients = hostClients.concat(additionalClients);

        // No requests were sent to clients, so callback with error
        if(hostClients.length === 0) {
            callback(null, "No KeySpace Hosts Available", 400, "No KeySpace Hosts Available", "Request-URL: " + requestString);
            return;
        }

        console.info("Requesting Keyspace content HEAD from (" + hostClients.length + ") Host Clients: " + requestString);


        // TODO: timeout, count, and try next host. FAIL!
        var hostContentFound = false;
        for(i=0; i<hostClients.length; i++) {
            KeySpaceDB.executeSocketGETRequest(requestString, hostClients[i],
                function(responseBody, responseCode, responseMessage, responseHeaders, respondingClient) {
                    if(hostContentFound)
                        return false;

                    // TODO: callback on all fail
                    if(responseCode !== 200)
                        return false;

                    if(requestType === 'head') {
                        // If it was just a HEAD request, then we're done
                        callback(responseBody, responseCode, responseMessage, responseHeaders, respondingClient);
                        hostContentFound = true;

                    } else {
                        // If not, then lets ask for the whole body from the responding client.
                        requestString = "GET " + requestURL + (requestHeaders ? "\n" + requestHeaders : "");
                        KeySpaceDB.executeSocketGETRequest(requestString, respondingClient,
                            function(responseBody, responseCode, responseMessage, responseHeaders, respondingClient) {
                                if(responseCode !== 200) {
                                    callback(respondingClient, "Responding Client failed to provide full GET request. What gives!?", responseCode, responseMessage, responseHeaders);
                                    return false;
                                }

                                callback(responseBody, responseCode, responseMessage, responseHeaders, respondingClient);
                                hostContentFound = true;
                            }
                        );
                    }
                }
            );
        }
    };

    //ServerSubscriptions.handleKeySpaceHTTPResponse = function(responseString, client) {
    //    var match = /^http\/1.1 (\d+)\s?([\w ]*)/i.exec(responseString);
    //    if(!match)
    //        throw new Error("Invalid HTTP Response: " + responseString);
    //
    //    var responseCode = parseInt(match[1]);
    //    var responseMessage = match[2];
    //
    //    var pos = responseString.indexOf("\n\n");
    //    var responseHeaders = responseString;
    //    var responseBody = null;
    //    if(pos > 0) {
    //        responseHeaders = responseString.substr(0, pos);
    //        responseBody = responseString.substr(pos+2);
    //    }
    //
    //    var headerLines = responseHeaders.split(/\n/g);
    //    var firstLine = headerLines.shift();
    //    responseHeaders = headerLines.join("\n");
    //
    //    var requestID = null;
    //    for(var i=0; i<headerLines.length; i++) {
    //        var headerSplit = headerLines[i].split(': ');
    //        var headerName = headerSplit[0].toLowerCase();
    //        switch(headerName) {
    //            case 'request-id':
    //                requestID = headerSplit[1];
    //                break;
    //        }
    //    }
    //
    //    if(requestID) {
    //        if(typeof keyspaceRequests[requestID] === 'undefined') {
    //            console.warn("Unhandled request ID: " + requestID);
    //            //send(client, "Unknown request ID: " + requestID);
    //            return false;
    //        }
    //
    //        var callback = keyspaceRequests[requestID];
    //        var deleteCallback = callback(client, responseBody, responseCode, responseMessage, responseHeaders);
    //        if(deleteCallback !== false)
    //            delete keyspaceRequests[requestID];
    //        return true;
    //    }
    //
    //    return false;
    //};

    function generateUID(format) {
        return (format).replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    function send(client, message) {
        if(client.readyState === client.OPEN) {
            client.send(message);
            console.info("O " + message);

        } else {
            console.warn("C " + message);
        }
    }

    // Return newly defined class
    return ServerSubscriptions;
})();
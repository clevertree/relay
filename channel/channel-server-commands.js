/**
 * Created by ari on 9/22/2015.
 */
if (!module) var module = {};
if (!module.exports) module.exports = {};
module.exports.initSocketServerChannelCommands = function(SocketServer) {
    //SocketServer.addEventListener('connection', initClient);
    //SocketServer.addCommand(messageClientCommand);

    SocketServer.addCommand(subscribeCommand);
    SocketServer.addCommand(unsubscribeCommand);

    SocketServer.addCommand(chatChannelCommand);
    SocketServer.addClientEventListener('close', channelClientCloseListener);
    //SocketServer.addEventListener('connection', channelClientOpenListener);

    //SocketServer.addCommand(leaveChannelCommand);
    //SocketServer.addCommand(nickClientCommand);
    //SocketServer.addCommand(keyListCommand);
};

var DEFAULT_MODE = 'event';

var ServerSubscriptions =
    require('../server/subscriptions/server-subscriptions.js')
    .ServerSubscriptions;

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

function channelClientCloseListener() {
    var client = this;
    unloadClient(client);
}

function unloadClient(client) {
    if(client.readyState === client.OPEN)
        throw new Error("Client was not disconnected");
    //console.info("Socket Client Closed: ", typeof client);
    if(!client.channels) {
        console.warn("Client had no active channels");
        return;
    }

    var activeChannels = client.channels;
    delete client.channels;

    for(var i=0; i<activeChannels[i]; i++) {
        var channel = activeChannels[i];
        var searchModes = ['chat', 'event'];
        for(var mi=0; mi<searchModes.length; mi++) {
            var mode = searchModes[mi];
            var clientList = ServerSubscriptions.getChannelSubscriptions(channel, mode);
            for(var j=0; j<clientList.length; j++) {
                if(clientList[j][0] === client) {
                    var argString = clientList[j][0];
                    console.log("TODO: unsubscribe - ", channel, mode, argString);
                    unsubscribeCommand("CHANNEL.UNSUBSCRIBE." + mode.toUpperCase() + " " + channel, client);
                }
            }
        }
    }
    //ServerSubscriptions.searchChannelSubscriptions(client, null, null,
    //    function(channelClient, channel, mode, argString) {
    //        console.log("TODO: unsubscribe - ", channel, mode, argString);
    //        unsubscribeCommand("CHANNEL.UNSUBSCRIBE." + mode.toUpperCase() + " " + channel, client);
    //    }
    //);
    return true;
}

// TODO: multiple
function subscribeCommand(commandString, client) {
    var match = /^(?:channel\.)?subscribe(?:\.(\w+))?\s+(\S+)\s*(\S*)\s*([\S\s]*)$/im.exec(commandString);
    if (!match)
        return false;

    var mode = match[1] || DEFAULT_MODE;
    var channel = match[2];
    var firstArgString = match[3];
    if(!firstArgString)
        firstArgString = "guest-" + generateUID('xxxx');
    var argString = match[4];
    //var username = argString.split(/\s+/)[0] || 'unknown';

    try {
        // TODO: Refactor this block into class
        var oldArgString = ServerSubscriptions.handleClientSubscription(commandString, client);
        var relayCommandString = "CHANNEL.SUBSCRIBE." + mode.toUpperCase() + " " + channel + " " + firstArgString;

        if(oldArgString) {
            console.log("Resubscribing from old: " + oldArgString);
            //var oldArgStringPrefix = oldArgString.split(/\s+/)[0];
            relayCommandString = "CHANNEL.RESUBSCRIBE." + mode.toUpperCase() + " " + channel + " " + firstArgString;
        }

        var clients = ServerSubscriptions.getChannelSubscriptions(channel, mode);
        var channelClientUserList = [firstArgString + (argString ? ' ' + argString : '')];
        for(var i=0; i<clients.length; i++) {
            var channelClient = clients[i][0];
            var channelClientArgString = clients[i][1];
            //var channelClientUsername = channelClientArgString.split(/\s+/)[0] || 'unknown';
            if(channelClient && channelClient.readyState === channelClient.OPEN) {
                // Relay to other subscribers
                send(channelClient, relayCommandString);
                // Add to user list
                if(channelClientUserList.indexOf(channelClientArgString) === -1)
                    channelClientUserList.push(channelClientArgString);
            } else {
                // TODO: invalid client?
            }
        }

        send(client, "CHANNEL.USERLIST." + mode.toUpperCase() + " " + channel + "\n" + channelClientUserList.join("\n"));

    } catch (e) {
        send(client, "ERROR " + e.message);
    }

    return true;
}

function unsubscribeCommand(commandString, client) {
    var match = /^(?:channel\.)?unsubscribe(?:\.(\w+))?\s+(\S+)$/im.exec(commandString);
    if (!match)
        return false;

    var mode = match[1] || DEFAULT_MODE;
    var channel = match[2];

    try {
        var oldArgString = ServerSubscriptions.handleClientSubscription(commandString, client);
        if(!oldArgString)
            throw new Error("Failed to unsubscribe: " + commandString);
        var oldUserName = oldArgString.split(/\s+/)[0];
        var relayCommandString = "CHANNEL.UNSUBSCRIBE." + mode.toUpperCase() + " " + channel + " " + oldUserName;
        var clients = ServerSubscriptions.searchChannelSubscriptions(channel, mode);
        for(var i=0; i<clients.length; i++) {
            if(!clients[i])
                console.log(clients);

            var channelClient = clients[i][0];
            if(channelClient.readyState === channelClient.OPEN) {
                // Inform other subscribers
                send(channelClient, relayCommandString);
            }
        }

    } catch (e) {
        send(client, "ERROR " + e.message);
    }
    return true;
}

function chatChannelCommand(commandString, client) {
    var match = /^(?:channel\.)?chat\s+([^\s]+)\s*([\s\S]*)$/im.exec(commandString);
    if(!match)
        return false;

    var channel = match[1];
    var mode = "CHAT";
    var message = match[2];
    //var clientInfo = getClientInfo(client);

    var username = null;
    var oldArgString = ServerSubscriptions.getClientChannelArgString(client, channel, mode);
    if(oldArgString) {
        username = oldArgString.split(' ')[0];

    } else {
        username = "guest-" + generateUID('xxxx');
        subscribeCommand("CHANNEL.SUBSCRIBE.CHAT " + channel + " " + username, client);
        //ServerSubscriptions.handleClientSubscription("CHANNEL.SUBSCRIBE.CHAT " + channel + " " + username, client);
        oldArgString = ServerSubscriptions.getClientChannelArgString(client, channel, mode);
        if(!oldArgString)
            throw new Error("Failed to auto-subscribe");
    }

    var relayCommandString = "CHANNEL.CHAT " + channel + " " + username + (message ? " " + message : "");
    var clients = ServerSubscriptions.getChannelSubscriptions(channel, mode);
    for(var i=0; i<clients.length; i++) {
        var channelClient = clients[i][0];
        if(channelClient.readyState === channelClient.OPEN) {
            // Inform other subscribers
            send(channelClient, relayCommandString);
        }
    }

    return true;
}
//
//
//function joinChannelCommand(commandString, client) {
//    var match = /^(?:channel\.)?join\s+(\S+)$/im.exec(commandString);
//    if(!match)
//        return false;
//
//    var channel = match[1];
//    var channelLowerCase = channel.toLowerCase();
//    //var clientInfo = getClientInfo(client);
//
//    if(typeof channelUsers[channelLowerCase] === 'undefined')
//        channelUsers[channelLowerCase] = [];
//
//    var clients = channelUsers[channelLowerCase];
//    var pos = clients.indexOf(client);
//    if(pos >= 0) {
//        send(client, "INFO Client already in channel: " + channel);
//        return true;
//    }
//
//    initClient(client);
//    clients.push(client);
//    client.chat.channels.push(channel);
//
//    var userList = [];
//    for(var i=0; i<clients.length; i++) {
//        var channelClient = clients[i];
//        if(channelClient.readyState === channelClient.OPEN) {
//            send(channelClient, "SUBSCRIBE " + channel + " " + client.chat.username + " " + Date.now());
//            userList.push(channelClient.chat.username);
//
//        } else {
//            //leaveChannelCommand("LEAVE " + channel, channelClient);
//        }
//    }
//
//    send(client, "USERLIST " + channel + " " + userList.join(" "));
//    return true;
//}
//
//
//function leaveChannelCommand(commandString, client) {
//    var match = /^leave\s+(\S+)$/im.exec(commandString);
//    if(!match)
//        return false;
//
//    var channel = match[1];
//    var channelLowerCase = channel.toLowerCase();
//    //var clientInfo = getClientInfo(client);
//
//    if(!channelUsers[channelLowerCase])
//        throw new Error("Channel does not exist: " + channelLowerCase);
//
//    var clients = channelUsers[channelLowerCase];
//    var pos = clients.indexOf(client);
//    if(pos === -1)
//        throw new Error("Client not in channel: " + channelLowerCase);
//
//    initClient(client);
//    clients.splice(pos, 1);
//    channelUsers[channelLowerCase] = clients;
//    for(var ci=0; ci<client.chat.channels.length; ci++) {
//        var userChannel = client.chat.channels[ci];
//        if(userChannel.toLowerCase() === channelLowerCase) {
//            client.chat.channels.splice(ci, 1);
//            break;
//        }
//    }
//
//    for(var i=0; i<clients.length; i++) {
//        var channelClient = clients[i];
//        if(channelClient.readyState === channelClient.OPEN) {
//            send(channelClient, "LEAVE " + channel + " " + client.chat.username + " " + Date.now());
//
//        } else {
//            //leaveChannelCommand("LEAVE " + channel, channelClient);
//        }
//    }
//
//    // Delete channel entry after last user leaves
//    if(channelUsers[channelLowerCase].length === 0)
//        delete channelUsers[channelLowerCase];
//
//    return true;
//}
//
//// KEYLIST Command
//function keyListCommand(commandString, client) {
//    var match = /^(?:channel\.)?keylist\s*(\S*)$/im.exec(commandString);
//    if(!match)
//        return false;
//    var filterChannel = match[1].toLowerCase();
//
//    initClient(client);
//
//    var keyspaces = [];
//    for(var i=0; i<client.chat.channels.length; i++) {
//        var channel = client.chat.channels[i];
//        var channelLowerCase = channel.toLowerCase();
//        if(filterChannel && channelLowerCase.indexOf(filterChannel) !== 0)
//            continue;
//        if(typeof channelUsers[channelLowerCase] === 'object') {
//            for(var j=0; j<channelUsers[channelLowerCase].length; j++) {
//                var channelClient = channelUsers[channelLowerCase][j];
//                if(channelClient.readyState === channelClient.OPEN
//                    && typeof channelClient.keyspace !== 'undefined') {
//                    for(var k=0; k<channelClient.keyspace; k++) {
//                        if(keyspaces.indexOf(channelClient.keyspace[k]) === -1) {
//                            keyspaces.push(channelClient.keyspace[k]);
//                        }
//                    }
//                }
//            }
//        }
//    }
//
//    send(client, "CHANNEL.KEYLIST " + filterChannel +
//        (keyspaces.length === 0 ? '' : "\n" + keyspaces.join("\n"))
//    );
//
//    return true;
//}


//// TODO: refactor
//function nickClientCommand(commandString, client) {
//    var match = /^(?:channel\.)?nick\s+([a-z0-9_-]{2,64})$/im.exec(commandString);
//    if(!match)
//        return false;
//
//    //var clientInfo = getClientInfo(client);
//    var newNick = match[1];
//    var oldNick = client.chat.username;
//    var now = Date.now();
//
//    var targetClient = clientUserNames[newNick.toLowerCase()];
//    if(typeof targetClient !== 'undefined' && targetClient.readyState === targetClient.OPEN)
//        throw new Error("Nick already exists. Please choose another.");
//
//    initClient(client);
//    client.chat.username = newNick;
//    delete clientUserNames[oldNick.toLowerCase()];
//    clientUserNames[newNick.toLowerCase()] = client;
//
//    var nickedClients = [];
//    for(var i=0; i<client.chat.channels.length; i++) {
//        var channel = client.chat.channels[i];
//        var channelLowerCase = channel.toLowerCase();
//        if(typeof channelUsers[channelLowerCase] === 'object') {
//            for(var j=0; j<channelUsers[channelLowerCase].length; j++) {
//                var channelClient = channelUsers[channelLowerCase][j];
//                if(channelClient.readyState === channelClient.OPEN) {
//                    if(nickedClients.indexOf(channelClient) === -1) {
//                        nickedClients.push(channelClient);
//                        send(channelClient, "NICK " + oldNick + " " + newNick + " " + now);
//                    }
//                }
//            }
//        }
//    }
//
//    if(nickedClients.indexOf(client) === -1) {
//        nickedClients.push(client);
//        send(client, "NICK " + oldNick + " " + newNick + " " + now);
//    }
//
//    return true;
//}

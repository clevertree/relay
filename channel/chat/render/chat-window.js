/**
 * Created by ari on 6/19/2015.
 */

// Client Script
if(typeof document === 'object') (function() {

    // Events

    document.addEventListener('submit', onFormEvent, false);
     document.addEventListener('change', onFormEvent, false);

    function onFormEvent(e, formElm) {
        if(!formElm) formElm = e.target.form ? e.target.form : e.target;
        if(formElm.nodeName.toLowerCase() !== 'form')
            return false;

        switch(formElm.getAttribute('name')) {
            case 'channel-form':
                if(e.type === 'submit') {
                    e.preventDefault();
                    submitChatForm(e, formElm);

                } else if(e.type === 'change') {

                    var selectedUsers = [];
                    for(var i=0; i<formElm.user_list.options.length; i++)
                        if(formElm.user_list.options[i].selected)
                            selectedUsers.push(formElm.user_list.options[i].value);

                    switch(e.target.name) {
                        case 'user_list':
                            console.log("Users Selected: " + selectedUsers.join(', '));
                            break;

                        case 'user_list_command':
                            var commandString = formElm.user_list_command.value;
                            var formattedCommandString = commandString;
                            e.target.value = '';

                            var promptMatch = /\[prompt:([^\]]+)\]/i.exec(formattedCommandString);
                            if(promptMatch)
                                formattedCommandString = formattedCommandString.replace(promptMatch[0],
                                    prompt(promptMatch[1]))

                            if(formattedCommandString.indexOf("[$username]") !== -1) {
                                for(var j=0; j<selectedUsers.length; j++) {
                                    formattedCommandString = formattedCommandString
                                        .replace('[$username]', selectedUsers[j])
                                        .replace('[$channel]', formElm.channel.value);

                                    var socketEvent = new CustomEvent('command', {
                                        detail: formattedCommandString,
                                        cancelable:true,
                                        bubbles:true
                                    });
                                    formElm.dispatchEvent(socketEvent);
                                    console.log("User Command: " + formattedCommandString);
                                }

                            } else {
                                formattedCommandString = formattedCommandString
                                    .replace('[$channel]', formElm.channel.value);

                                var socketEvent = new CustomEvent('command', {
                                    detail: formattedCommandString,
                                    cancelable:true,
                                    bubbles:true
                                });
                                formElm.dispatchEvent(socketEvent);
                                console.log("Channel Command: " + formattedCommandString);
                            }

                            break;
                    }
                }

                return true;

            default:
                return false;
        }
    }

    function submitChatForm(e) {
        var formElm = e.target;
        if(formElm.nodeName.toLowerCase() !== 'form')
            throw new Error("Invalid Form: " + formElm);

        var messageElm = formElm.querySelector('*[name=message], input[type=text], textarea');
        if(!messageElm)
            throw new Error("No message field found");

        var channelElm = formElm.querySelector('*[name=channel]');
        if(!channelElm || !channelElm.value)
            throw new Error("No channel value found");

        if(!messageElm.value)
            return false;
        // if hasn't identified yet, ask to identify now

        var commandString = "CHAT " + channelElm.value + " " + messageElm.value;
        if(messageElm.value[0] === '/')
            commandString = messageElm.value.substr(1);

        var socketEvent = new CustomEvent('command', {
            detail: commandString,
            cancelable:true,
            bubbles:true
        });
        formElm.dispatchEvent(socketEvent);
        if(socketEvent.defaultPrevented)
            messageElm.value = '';

        return false;
    }
})();

// Worker Script
if(typeof module === 'object') (function() {
    var TEMPLATE_URL = 'channel/chat/render/chat-window.html';

    module.exports.renderChatWindow = function(channelPath, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", TEMPLATE_URL, false);
        xhr.send();
        if(xhr.status !== 200)
            throw new Error("Error: " + xhr.responseText);

        callback(xhr.responseText
            .replace(/{\$channel}/gi, channelPath)
            .replace(/{\$channel_lowercase}/gi, channelPath.toLowerCase())
        );

        return true;
    };

    module.exports.renderChatMessage = function(responseString, callback) {
        var match = /^(chat)\s+(\S+)\s+(\S+)\s+(\d+)\s+([\s\S]+)$/im.exec(responseString);
        if (!match)
            throw new Error("Invalid Chat Response: " + responseString);
        var channelPath = match[2];
        var username = match[3];
        var timestamp = parseInt(match[4]);
        var content = (match[5]); // fixPGPMessage


        var MESSAGE_TEMPLATE =
            '<div class="channel-log-entry">' +
                '<a href="#MESSAGE {$username}" class="username" data-timestamp="{$timestamp}">{$username}</a>' +
                ': <span class="message">{$content}</span>' +
            '</div>';

        callback(MESSAGE_TEMPLATE
            .replace(/{\$timestamp}/gi, timestamp+'')
            .replace(/{\$channel}/gi, channelPath)
            .replace(/{\$username}/gi, username)
            .replace(/{\$content}/gi, content),
            username
        );
    };

    module.exports.renderChatActionEntry = function(responseString, callback) {
        var args = responseString.split(/\s/);
        var channelPath = args[1];
        var username = args[2];

        var actionText = '';
        switch(args[0].toLowerCase()) {
            case 'join': actionText = 'joined'; break;
            case 'leave': actionText = 'left'; break;
            default: throw new Error("Unknown action: " + responseString);
        }

        var ACTION_TEMPLATE =
            '<div class="channel-log-entry">' +
                '<a href="#MESSAGE {$username}" class="username" data-timestamp="{$timestamp}">{$username}</a>' +
                ' has <span class="action">{$action}</span>' +
                ' <a href="#JOIN {$channel}" class="path">{$channel}</a>' +
            '</div>';

        callback(ACTION_TEMPLATE
            .replace(/{\$action}/gi, actionText)
            .replace(/{\$channel}/gi, channelPath)
            .replace(/{\$username}/gi, username)
        );
    };

    module.exports.renderChatNickChange = function (commandResponse, callback) {
        var args = commandResponse.split(/\s/);
        var old_username = args[1];
        var new_username = args[2];

        var NICK_TEMPLATE =
            '<div class="channel-log-entry">' +
                'Username <span class="username">{$old_username}</span>' +
                ' has been <span class="action">renamed</span> to' +
                ' <a href="#MESSAGE {$username}" class="username" data-timestamp="{$timestamp}">{$username}</a>' +

            '</div>';

        callback(NICK_TEMPLATE
            .replace(/{\$old_username}/gi, old_username)
            .replace(/{\$username}/gi, new_username)
        );
    };


    module.exports.renderChatUserList = function(channelPath, userList, callback) {
        var optionHTML = "<optgroup class='channel-users:" + channelPath.toLowerCase() + "' label='Active Users (" + userList.length + ")'>\n";

        for (var i = 0; i < userList.length; i++) {
            var username = userList[i];
            optionHTML += "\n\t<option>" + username + "</option>"
        }
        optionHTML += "\n</optgroup>";
        callback(optionHTML);
    };
})();
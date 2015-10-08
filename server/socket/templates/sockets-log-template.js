/**
 * Created by ari on 6/19/2015.
 */

var Templates = Templates || {};
Templates.socket = Templates.socket || {};
Templates.socket.log = Templates.socket.log || {};
Templates.socket.log.container = function(url, callback) {

    // Template
    var SOCKET_TEMPLATE = "\
        <article class='channel socket:{$url} minimized' data-sort='z'>\n\
            <link rel='stylesheet' href='server/socket/sockets.css' type='text/css'>\n\
            <legend class='title'>\n\
                <a href='#MINIMIZE socket:{$url}'>\n\
                    <span class='command'>Socket</span> {$host}\n\
                </a>\n\
            </legend>\n\
            <div class='title-commands'>\n\
                <a class='title-command-minimize' href='#MINIMIZE socket:{$url}'>[-]</a><!--\
             --><a class='title-command-maximize' href='#MAXIMIZE socket:{$url}'>[+]</a><!--\
             --><a class='title-command-close' href='#CLOSE socket:{$url}'>[x]</a>\n\
            </div>\n\
            <fieldset class='socket-log socket-log:{$url}'></fieldset>\n\
            </form>\n\
        </article>";

    var match = url.match(new RegExp("^(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(\\?([^#]*))?(#(.*))?"));
    var host = match[4];
    if(!host)
        throw new Error("Invalid Host: " + url);

    // Callback
    return callback(SOCKET_TEMPLATE
            .replace(/{\$host}/gi, host)
            .replace(/{\$url}/gi, url)
    );
};


Templates.socket.log.entry = function(socketMessageContent, direction, callback) {
    // Template
    var SOCKET_TEMPLATE_LOG_ENTRY = "\
        <div class='log-entry'>\n\
            <span class='direction'>{$DIR}</span>:\n\
            <span class='message'>{$content}</span>\n\
        </div>\
    ";

    // Callback
    return callback(SOCKET_TEMPLATE_LOG_ENTRY
        .replace(/{\$DIR}/g, direction)
        .replace(/{\$content}/gi, socketMessageContent
            .replace(/&/g, '&amp;')
            .replace(/&amp;amp;/, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        )
    );
};


Templates.socket.log.action = function(action, callback) {
    // Template
    var SOCKET_TEMPLATE_ACTION_ENTRY = "\
        <div class='log-entry'>\n\
            <span class='action'>{$action}</span>\n\
        </div>\n\
        ";

    // Callback
    callback(SOCKET_TEMPLATE_ACTION_ENTRY
        .replace(/{\$action}/gi, action)
    );
};
/**
 * Created by ari on 6/19/2015.
 */

// Client Script
if(typeof document === 'object')
    (function() {

        // Events

        //self.addEventListener('submit', onFormEvent);
        //self.addEventListener('input', onFormEvent);
        //self.addEventListener('change', onFormEvent);

    })();


// Worker Script
else
    (function() {
        module.exports.renderSocketLogContainer = function(url, callback) {
            var match = url.match(new RegExp("^(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(\\?([^#]*))?(#(.*))?"));
            var host = match[4];
            if(!host)
                throw new Error("Invalid Host: " + url);

            var TEMPLATE_URL = 'server/socket/render/socket-log-window.html';

            var xhr = new XMLHttpRequest();
            xhr.open("GET", TEMPLATE_URL);
            xhr.onload = function () {
                callback(xhr.responseText
                        .replace(/{\$host}/gi, host)
                        .replace(/{\$url}/gi, url)
                );
            };
            xhr.send();

            return true;
        };

        module.exports.renderSocketLogEntry = function(socketMessageContent, direction, callback) {
            // Template
            var SOCKET_TEMPLATE_LOG_ENTRY =
                "\n<div class='log-entry'>" +
                "\n\t<span class='direction'>{$DIR}</span>:" +
                "\n\t<span class='message'>{$content}</span>" +
                "\n</div>";

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


        module.exports.renderSocketLogActionEntry = function(action, callback) {
            // Template
            var SOCKET_TEMPLATE_ACTION_ENTRY =
                "\n<div class='log-entry'>" +
                "\n\t<span class='action'>{$action}</span>" +
                "\n</div>";

            // Callback
            callback(SOCKET_TEMPLATE_ACTION_ENTRY
                .replace(/{\$action}/gi, action)
            );
        };
    })();
if (!module) var module = {};
if (!module.exports) module.exports = {};
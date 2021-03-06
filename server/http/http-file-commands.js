/**
 * Created by ari on 9/22/2015.
 */
if (!module) var module = {};
if (!module.exports) module.exports = {};
module.exports.initHTTPFileCommands = function(HTTPServer) {
    HTTPServer.addCommand(getStaticHTTPCommand);
    console.log("Loaded " + __filename);
};

function getStaticHTTPCommand(request, response) {
    if(request.method.toLowerCase() !== 'get')
        return false;

    handleFileRequest(request.url, function(responseBody, statusCode, statusMessage, headers) {
        response.writeHead(statusCode || 200, statusMessage || 'OK', headers);
        response.end(responseBody);
    });
    return true;
}

function handleFileRequest(requestURI, responseCallback) {
    var fs = require('fs');

    var filePath = '.' + requestURI.split('?')[0];
    if (filePath[filePath.length-1] === '/')
        filePath += 'index.html';

    var contentType = getContentType(filePath);

    fs.readFile(filePath, function (error, content) {
        if (error) {
            if (error.code == 'ENOENT') {
                fs.readFile('./404.html', function (error, content) {
                    responseCallback(content, 404, 'NOT FOUND', {
                        'Content-Type': contentType
                    });
                });
            }
            else {
                responseCallback('Sorry, check with the site admin for error: ' + error.code + ' ..\n', 500, 'ERR', {
                    'Content-Type': contentType
                });
            }
        }
        else {
            responseCallback(content, 200, 'OK', {
                'Content-Type': contentType
            });
        }
    });
}


function getContentType(filePath) {
    var extname = filePath.split('?')[0].split('.').pop().toLowerCase();
    switch (extname) {
        case 'htm':
        case 'html':
            return 'text/html';
        case 'js':
            return 'text/javascript';
        case 'css':
            return 'text/css';
        case 'json':
            return 'application/json';
        case 'png':
            return 'image/png';
        case 'jpg':
            return 'image/jpg';
        case 'wav':
            return 'audio/wav';
        case 'ico':
            return 'image/x-icon';
        case 'map':
        case 'ttf':
            return 'application/octet-stream';
        case 'pdf':
            return 'application/pdf';

        default:
            console.error("Unknown file type: " + filePath);
            return 'application/octet-stream';
    }
}

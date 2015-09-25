/**
 * Created by ari on 6/19/2015.
 */
var Templates = Templates || {};
Templates.rest = Templates.rest || {};
Templates.rest.response = Templates.rest.response || {};
Templates.rest.response.body = function(body, url, code, text, headers, callback) {

    var RESPONSE_BODY_TEMPLATE = "\
HTTP/1.1 {$response_code} {$response_text}\n\
Content-type: text/html\n\
Content-length: {$response_length}\n\
Request-url: {$request_url}\n\
{$response_headers}\
\n\n\
{$response_body}";

    callback(RESPONSE_BODY_TEMPLATE
            .replace(/{\$response_headers}/gi, headers.trim())
            .replace(/{\$response_code}/gi, code || '200')
            .replace(/{\$response_text}/gi, text || 'OK')
            .replace(/{\$request_url}/gi, url)
            .replace(/{\$response_length}/gi, body.length)
            .replace(/{\$response_body}/gi, body)
    );
};
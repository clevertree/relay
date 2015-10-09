/**
 * Created by ari on 6/19/2015.
 */


var Templates = Templates || {};
Templates.ks = Templates.ks || {};
Templates.ks.put = Templates.ks.put || {};
Templates.ks.put.template = function(commandString, callback, Client) {
    var match = /^put\.template\s*(\S*)/im.exec(commandString);
    if(!match)
        return false;

    var template = match[1];

    var PUT_SELECT_TEMPLATE = "\
        <article class='channel put-template: {$classes}'>\n\
            <script src='ks/listeners/ks-put-template-listeners.js'></script>\n\
            <link rel='stylesheet' href='ks/ks.css' type='text/css'>\n\
            <header class='title-bar'>\n\
                <strong>Choose a </strong><span class='command'>Template</span><span>:</span>\
                <a class='title-bar-minimize' href='#MINIMIZE put-preview:'>[-]</a><!--\n\
             --><a class='title-bar-maximize' href='#MAXIMIZE put-preview:'>[+]</a><!--\n\
             --><a class='title-bar-close' href='#CLOSE put:'>[x]</a>\n\
            </header>\
            <form name='ks-put-template-form'>\n\
                <label class='label-select-template hide-on-compact'>\n\
                    <select name='template' style='width:12em;'>\n\
                        <option value=''>Choose a Template</option>\n\
                        {$html_script_options}\n\
                    </select>\n\
                </label>&nbsp;\n\
            </form>\n\
            <section class='put-template-content:' style='position:relative;'>\
                {$template_content}\
            </section>\n\
            <br/>\n\
        </article>";

    var classes = [];

    var html_script_options = '';
    var templateFound = null;
    var scripts = Client.require('ks/ks-content-scripts.js').getContentScripts();
    for(var i=0; i<scripts.length; i++) {
        var opts = scripts[i];
        html_script_options += "<option value='" + opts[0] + "'>" + opts[1] + "</option>\n";
        if(template && template === opts[0])
            templateFound = opts;
    }

    if(templateFound) {
        Client.require(template).runScript(commandString, function(template_content) {
            // Callback
            callback(PUT_SELECT_TEMPLATE
                    .replace(/{\$classes}/gi, classes ? classes.join(' ') : '')
                    .replace(/{\$html_script_options}/gi, html_script_options)
                    .replace(/{\$template_content}/gi, '<hr/>' + template_content)
            );
        });

    } else {
        // Callback
        callback(PUT_SELECT_TEMPLATE
                .replace(/{\$classes}/gi, classes ? classes.join(' ') : '')
                .replace(/{\$html_script_options}/gi, html_script_options)
                .replace(/{\$template_content}/gi, '')
        );
    }

};


    // " + EXAMPLE_VOTE + "\n\

    //<hr/><label class='label-pgp-id-private hide-on-compact'>Post with (PGP Identity):<br/>\n\
    //                <select name='pgp_id_public' required='required'>\n\
    //                    <option value=''>Select a PGP Identity</option>\n\
    //                    <optgroup class='pgp-identities' label='My PGP Identities'>\n\
    //                        {$html_pgp_id_public}\n\
    //                    </optgroup>\n\
    //                    <optgroup label='Other options'>\n\
    //                        <option value='' disabled='disabled'>Manage PGP Identities...</option>\n\
    //                        <option value='' disabled='disabled'>Look up Identity...</option>\n\
    //                    </optgroup>\n\
    //                </select>\n\
    //            <br/><br/></label>\n\
    //                <label class='label-passphrase hide-on-compact hide-on-no-passphrase-required'>PGP Passphrase (if required):<br/>\n\
    //                    <input type='password' name='passphrase' placeholder='Enter your PGP Passphrase'/>\n\
    //                    <br/><br/></label>\n\

    //<label class='label-submit hide-on-compact'>\n\
    //    <input class='pressed' type='checkbox' name='preview' {$attr_preview_checked}/>Preview your post\n\
    //</label>\n\

    //var form_classes = [];
    //var html_pgp_id_public_html = '';
    //var html_path_options = '';

    // Query private key(s)
    //var path = '/public/id';
    //getKeySpaceDB().queryAll(path, function(err, content) {

        //if(err)
        //    throw new Error(err);

        //if(content) {
        //    html_pgp_id_public_html +=
        //        '<option value="' + content.pgp_id_public + '">' +
        //            content.user_id.replace(/</, '&lt;') +
        //        '</option>';

        //} else {
            // Callback
        //}

    //});

//<label class='label-recipients show-section-on-value'>Choose which subscribers may view this post:<br/>\n\
//    <select name='recipients'>\n\
//        <option value='*'>Everybody</option>\n\
//        <option disabled='disabled'>My friends</option>\n\
//        <option disabled='disabled'>Friends of Friends</option>\n\
//        <option disabled='disabled'>Specific Recipients</option>\n\
//    </select>\n\
//<br/><br/></label>\n\




function getKeySpaceDB() {
    if(typeof self.KeySpaceDB === 'undefined') {
        if(typeof importScripts === "function")
            importScripts('ks/ks-db.js');
        else
            self.KeySpaceDB = require('./ks-db.js').KeySpaceDB;
    }
    return self.KeySpaceDB;
}

var EXAMPLE_VOTE = "\
        <ul draggable='true' class='app.vote' data-id='abcd'>\n\
            <script src='app/vote/vote-listeners.js'></script>\n\
            <lh class='app.vote.title'>Vote 'abcd'</lh>\n\
            <li class='app.vote.option' data-option-id='abcd.1'>Option #1</li>\n\
            <li class='app.vote.option' data-option-id='abcd.2'>Option #2</li>\n\
            <li class='app.vote.option' data-option-id='abcd.3'>Option #3</li>\n\
        </ul>";

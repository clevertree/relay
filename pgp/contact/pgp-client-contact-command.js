/**
 * Ari 7/2/2015.
 */
if(typeof module === 'object') (function() {
    module.exports.initClientPGPContactCommand = function (Client) {
        Client.addCommand(contactCommand);

        /**
         * @param commandString
         */
        function contactCommand(commandString) {
            var match = /^pgp.contact/i.exec(commandString);
            if (!match)
                return false;

            self.module = {exports: {}};
            importScripts('pgp/contact/render/pgp-contact-list.js');
            var templateExports = self.module.exports;

            templateExports.renderPGPContactList(function (html) {
                Client.render(html);
            });
            return true;
        }

    };
})();
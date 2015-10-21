/**
 * Ari 7/2/2015.
 */
if (!module) var module = {exports:{}};
module.exports.initClientPGPManageCommand = function(Client) {
    Client.addCommand(manageCommand);

    /**
     * @param commandString
     * @param status_content
     */
    function manageCommand(commandString, e, status_content) {
        var match = /^pgp.manage/i.exec(commandString);
        if(!match)
            return false;

        self.module = {exports: {}};
        importScripts('pgp/manage/render/pgp-manage-form.js');
        var templateExports = self.module.exports;

        templateExports.renderPGPManageForm(status_content, function(html) {
            Client.render(html);
        });
        return true;
    }

};
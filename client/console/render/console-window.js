/**
 * Created by ari on 7/2/2015.
 */


(function() {

    // Client Script
    if(typeof document === 'object')  {
        // Events
        //document.addEventListener('command', onCommandEvent, false);
        document.addEventListener('submit', onFormEvent, false);
        document.addEventListener('keydown', onFormEvent, false);
        //if(console.log !== consoleLogCallback) {
        //    var oldLog = console.log;
        //    console.log = function(message) {
        //        oldLog(message);
        //        consoleLogCallback(message);
        //    }
        //}
    }


    // Worker Scripts
    if(typeof module === 'object') {
        module.exports.renderConsoleWindow = renderConsoleWindow;
        module.exports.renderConsoleEntry = renderConsoleEntry;
        //module.exports.renderConsoleActionEntry = renderConsoleActionEntry;
    }

    var TEMPLATE_URL = 'client/console/render/console-window.html';
    var CONTAINER_ID = 'console-window';
    var activeContainers = [];

    function renderConsoleWindow(callback) {
        if(activeContainers.indexOf(CONTAINER_ID) >= 0)
            return false;
        activeContainers.push(CONTAINER_ID);

        var xhr = new XMLHttpRequest();
        xhr.open("GET", TEMPLATE_URL, false);
        xhr.send();
        if(xhr.status !== 200)
            throw new Error("Error: " + xhr.responseText);
        callback(xhr.responseText
                //.replace(/{\$url}/gi, url)
        );
    }

    //function renderConsoleEntry(consoleContent, direction, callback) {
    //    // Template
    //    var SOCKET_TEMPLATE_CONSOLE_ENTRY =
    //        "\n<div class='console-entry'>" +
    //        "\n\t<span class='direction'>{$DIR}:</span>" +
    //        "\n\t<span class='message'>{$content}</span>" +
    //        "\n</div>";
    //
    //    var consoleContentEscaped = consoleContent
    //        .replace(/&/g, '&amp;')
    //        .replace(/</g, '&lt;')
    //        .replace(/>/g, '&gt;')
    //        .replace(/"/g, '&quot;');
    //
    //    var consoleEntryHTML = SOCKET_TEMPLATE_CONSOLE_ENTRY
    //        .replace(/{\$DIR}/g, direction)
    //        .replace(/{\$content}/gi, consoleContentEscaped);
    //
    //    // Callback
    //    return callback(consoleEntryHTML, callback)
    //}


    function renderConsoleEntry(content, callback) {
        // Template
        var SOCKET_TEMPLATE_ACTION_ENTRY =
            "\n<div class='console-entry'>" +
            "\n\t{$content}" +
            "\n</div>";

        var consoleEntryHTML = SOCKET_TEMPLATE_ACTION_ENTRY
            .replace(/{\$content}/g, content);

        // Callback
        return callback(consoleEntryHTML, callback)
    }

    function onFormEvent(e, formElm) {
        if(!formElm) formElm = e.target.form ? e.target.form : e.target;
        if(formElm.nodeName.toLowerCase() !== 'form')
            return false;

        switch(formElm.getAttribute('name')) {
            case 'console-form':
                if(e.type === 'submit')
                    submitConsoleForm(e, formElm);
                if(e.type.substr(0, 3) === 'key')
                    handleFormKeyEvent(e, formElm);
                return true;

            default:
                return false;
        }
    }

    var history = [];
    var historyPos = 0;
    function handleFormKeyEvent(e, formElm) {
        var messageElm = formElm.querySelector('*[name=message], input[type=text], textarea');
        switch(e.which) {
            case 38: // UP
                messageElm.value = nextHistory(-1);
                break;

            case 40: // Down
                messageElm.value = nextHistory(1);
                break;
        }

        function nextHistory(inc) {
            historyPos += inc;
            if(historyPos > history.length-1)
                historyPos = 0;
            else if (historyPos < 0)
                historyPos = history.length-1;
            return history[historyPos];
        }
    }


    function submitConsoleForm(e, formElm) {
        e.preventDefault();
        formElm = formElm || e.target.form || e.target;
        if(formElm.nodeName.toLowerCase() !== 'form')
            throw new Error("Invalid Form: " + formElm);

        var messageElm = formElm.querySelector('*[name=message], input[type=text], textarea');
        if(!messageElm)
            throw new Error("No message field found");

        if(!messageElm.value)
            return false;

        var commandString = messageElm.value;
        if(messageElm.value[0] === '/')
            commandString = messageElm.value.substr(1);

        var commandEvent = new CustomEvent('command', {
            detail: commandString,
            cancelable:true,
            bubbles:true
        });
        formElm.dispatchEvent(commandEvent);
        if(!commandEvent.defaultPrevented)
            throw new Error("Command event not handled");
        history.push(messageElm.value);
        messageElm.value = '';
        return false;
    }

    function onCommandEvent(e) {
        e.preventDefault();
        var commandString = e.detail || e.data;
        renderConsoleEntry(
            "<span class='prompt'>$</span>" + commandString + "<span class='command'>",
            function(html) {
                var consoleLogs = document.getElementsByClassName('console-content:');
                for(var i=0; i<consoleLogs.length; i++) {
                    var elm = document.createElement('div');
                    elm.innerHTML = html;
                    consoleLogs[i].appendChild(elm.children[0]);
                }
            });
    }
})();

/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package relay.service.command;

import java.io.IOException;
import javax.websocket.Session;

/**
 *
 * @author ari
 */
public class RESTCommands implements ISocketCommand {
    
    private String RESPONSE_TEMPLATE =
        "HTTP/1.1 {$code} {$text}\n" +
        "Content-type: text/html\n" +
        "Content-length: {$length}\n" +
        "Request-url: {$url}\n" +
        "{$headers}" +
        "\n\n" +
        "{$body}";
    
    @Override
    public void onSocketOpen(Session newSession) throws Exception {
    }

    @Override
    public void onSocketClosed(Session oldSession) throws Exception {
    }
    
    @Override
    public boolean executeCommand(String data, Session session) throws Exception {
        String[] args = data.split("\\s+", 2);
        switch(args[0].toLowerCase()) {
            case "get":
                getRequest(session, data);
                return true;
                
            default:
                return false;
        }
//        session.getBasicRemote().sendText("ECHO " + message);
    }
    
    public void getRequest(Session session, String data) {
        String[] lines = data.split("\n");
        String firstLine = lines[0];
        int responseCode = 200;
        String responseText = "OK";
        String responseBody = "";
        String requestURL = "";
        if(firstLine.substring(0, 4).compareToIgnoreCase("GET ") != 0) {
            responseText = "Invalid GET Request";
            responseCode = 404;
            
        } else {
            requestURL = firstLine.substring(4).trim();

        }
        
        if(responseCode == 200) {
            responseCode = 404;
            responseText = "Found Nerfin'";
            responseBody = "<h1>404 Found Nerfin'</h1>";
        }
        
        sendText(session, RESPONSE_TEMPLATE
            .replace("{$code}", responseCode + "")
            .replace("{$text}", responseText)
            .replace("{$url}", requestURL)
            .replace("{$headers}", requestURL)
            .replace("{$length}", responseBody.length() + "")
            .replace("{$body}", responseBody)
        );
    }

    public String getSessionChatID(Session session) {
        PGPCommands.PGPUserInfo userInfo = PGPCommands.getStatic().getSessionPGPInfo(session);
        return userInfo.SessionUID; // userInfo.getUserName(session);
    }
    
    private void sendText(Session session, String text) {
        try {
            System.out.println(getSessionChatID(session) + " SENDING " + text); 
            session.getBasicRemote().sendText(text);
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
    
    
    // Static
    
    private static RESTCommands _inst = null;
    public static RESTCommands getStatic() {
        if(_inst != null)
            return _inst;
        _inst = new RESTCommands();
        return _inst;
    }
    

}
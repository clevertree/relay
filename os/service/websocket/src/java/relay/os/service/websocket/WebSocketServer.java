/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

package relay.os.service.websocket;

import java.io.IOException;
import java.util.ArrayList;
 
import javax.websocket.OnClose;
import javax.websocket.OnError;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;
 
/** 
 * @ServerEndpoint gives the relative name for the end point
 * This will be accessed via ws://localhost:8080/EchoChamber/echo
 * Where "localhost" is the address of the host,
 * "EchoChamber" is the name of the package
 * and "echo" is the address to access this class from the server
 */
@ServerEndpoint("/socket") 
public class WebSocketServer {
    
    private ArrayList<ISocketCommand> callbacks = new ArrayList<>();
    
    public void addCommand(ISocketCommand command) {
        callbacks.add(command);
    }
    
    /**
     * @OnOpen allows us to intercept the creation of a new session.
     * The session class allows us to send data to the user.
     * In the method onOpen, we'll let the user know that the handshake was 
     * successful.
     */
    @OnOpen
    public void onOpen(Session session){
        System.out.println(session.getId() + " has opened a connection"); 
        try {
            
            session.getBasicRemote().sendText("Connection Established");
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
 
    /**
     * When a user sends a message to the server, this method will intercept the message
     * and allow us to react to it. For now the message is read as a String.
     */
    @OnMessage
    public void onMessage(String message, Session session) throws IOException{
        System.out.println("Message from " + session.getId() + ": " + message);
        session.getBasicRemote().sendText("ECHO " + message);
        
        for(int i=0; i<callbacks.size(); i++) {
            try {
                ISocketCommand command = callbacks.get(i);
                if(command instanceof ISocketCommand.ISocketCommandMatch) {
                    ISocketCommand.ISocketCommandMatch matchCommand = (ISocketCommand.ISocketCommandMatch) command;
                    if(!matchCommand.match(message, session))
                        continue;
                } else {
                    String[] args = message.split("\\s+", 2);
                    if(!args[0].equalsIgnoreCase(command.getCommandName()))
                        continue;
                }
                command.executeCommand(message, session);
            } catch (Exception ex) {
                    session.getBasicRemote().sendText(ex.getMessage());
            }
        }
    }
 
    /**
     * The user closes the connection.
     * 
     * Note: you can't send messages to the client from this method
     */
    @OnClose
    public void onClose(Session session){
        System.out.println("Session " +session.getId()+" has ended");
    }

    @OnError
    public void onError(Throwable t) {
        System.out.println("Error: " + t.getMessage());
    }
}

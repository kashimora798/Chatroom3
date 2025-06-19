import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Send, Image, LogOut, CheckCheck, Check } from 'lucide-react'

const Chat = () => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [userPresence, setUserPresence] = useState({})
  const { user, signOut } = useAuth()
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const subscriptionRef = useRef(null)
  const presenceChannelRef = useRef(null)
  const heartbeatRef = useRef(null)

  // Presence tracking functions
  const updatePresence = async (isOnline = true) => {
    if (!user) return
    
    try {
      await supabase
        .from('user_presence')
        .upsert({
          user_id: user.id,
          is_online: isOnline,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
    } catch (error) {
      console.error('Error updating presence:', error)
    }
  }

  const fetchPresenceData = async () => {
    try {
      const { data } = await supabase
        .from('user_presence')
        .select('*')
      
      if (data) {
        const presenceMap = {}
        data.forEach(p => {
          presenceMap[p.user_id] = p
        })
        setUserPresence(presenceMap)
      }
    } catch (error) {
      console.error('Error fetching presence:', error)
    }
  }

  const startPresenceTracking = async () => {
    if (!user) return

    // Set user as online
    await updatePresence(true)

    // Setup heartbeat to update presence every 30 seconds
    heartbeatRef.current = setInterval(() => {
      updatePresence(true)
    }, 30000)

    // Setup presence channel for real-time updates
    try {
      presenceChannelRef.current = supabase
        .channel('user_presence_changes')
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'user_presence' },
          (payload) => {
            if (payload.new) {
              setUserPresence(prev => ({
                ...prev,
                [payload.new.user_id]: payload.new
              }))
            }
          }
        )
        .subscribe()

      // Initial fetch of presence data
      await fetchPresenceData()
    } catch (error) {
      console.error('Error setting up presence tracking:', error)
    }
  }

  const stopPresenceTracking = async () => {
    // Clear heartbeat
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }

    // Unsubscribe from presence channel
    if (presenceChannelRef.current) {
      try {
        presenceChannelRef.current.unsubscribe()
        presenceChannelRef.current = null
      } catch (error) {
        console.error('Error unsubscribing from presence:', error)
      }
    }

    // Set user as offline
    await updatePresence(false)
  }

  useEffect(() => {
    if (user) {
      fetchMessages()
      subscribeToMessages()
      
      // Start presence tracking with a small delay to ensure everything is set up
      setTimeout(() => {
        startPresenceTracking()
      }, 1000)
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      
      stopPresenceTracking()
    }
  }, [user])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching messages:', error)
      } else {
        setMessages(data || [])
        // Mark messages as seen
        markMessagesAsSeen(data || [])
      }
    } catch (error) {
      console.error('Error in fetchMessages:', error)
    }
  }

  const markMessagesAsSeen = async (messages) => {
    try {
      const unseenMessages = messages.filter(msg => 
        msg.user_id !== user.id && msg.seen === false
      )

      if (unseenMessages.length > 0) {
        const messageIds = unseenMessages.map(msg => msg.id)
        
        await supabase
          .from('messages')
          .update({ 
            seen: true, 
            seen_at: new Date().toISOString() 
          })
          .in('id', messageIds)
      }
    } catch (error) {
      console.error('Error marking messages as seen:', error)
    }
  }

  const subscribeToMessages = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
    }

    const channel = supabase.channel(`messages-${Date.now()}`)
    
    subscriptionRef.current = channel
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages(prev => [...prev, payload.new])
          
          // If it's not our message, mark it as seen after a short delay
          if (payload.new.user_id !== user.id) {
            setTimeout(async () => {
              try {
                await supabase
                  .from('messages')
                  .update({ 
                    seen: true, 
                    seen_at: new Date().toISOString() 
                  })
                  .eq('id', payload.new.id)
              } catch (error) {
                console.error('Error marking message as seen:', error)
              }
            }, 1000)
          }
        }
      )
      .on('postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages(prev => 
            prev.map(msg => 
              msg.id === payload.new.id ? payload.new : msg
            )
          )
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to messages')
        }
      })
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([
          {
            content: newMessage,
            user_id: user.id,
            username: user.email,
            delivered: false,
            seen: false
          }
        ])
        .select()

      if (error) {
        console.error('Error sending message:', error)
      } else {
        setNewMessage('')
        
        // Auto-mark as delivered after a short delay
        if (data && data[0]) {
          setTimeout(async () => {
            try {
              await supabase
                .from('messages')
                .update({ 
                  delivered: true, 
                  delivered_at: new Date().toISOString() 
                })
                .eq('id', data[0].id)
            } catch (error) {
              console.error('Error updating delivery status:', error)
            }
          }, 1000)
        }
      }
    } catch (error) {
      console.error('Error in sendMessage:', error)
    }
    
    setLoading(false)
  }

  const uploadImage = async (file) => {
    setUploadingImage(true)
    
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file)

      if (uploadError) {
        console.error('Error uploading image:', uploadError)
        setUploadingImage(false)
        return
      }

      const { data } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath)

      const { data: messageData, error } = await supabase
        .from('messages')
        .insert([
          {
            image_url: data.publicUrl,
            user_id: user.id,
            username: user.email,
            delivered: false,
            seen: false
          }
        ])
        .select()

      if (error) {
        console.error('Error sending image message:', error)
      } else if (messageData && messageData[0]) {
        // Auto-mark as delivered after a short delay
        setTimeout(async () => {
          try {
            await supabase
              .from('messages')
              .update({ 
                delivered: true, 
                delivered_at: new Date().toISOString() 
              })
              .eq('id', messageData[0].id)
          } catch (error) {
            console.error('Error updating image delivery status:', error)
          }
        }, 1000)
      }
    } catch (error) {
      console.error('Error in uploadImage:', error)
    }
    
    setUploadingImage(false)
  }

  const handleImageUpload = (e) => {
    const file = e.target.files[0]
    if (file) {
      uploadImage(file)
    }
  }

  const handleSignOut = async () => {
    await stopPresenceTracking()
    
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    
    await signOut()
  }

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Function to check if user is online
  const isUserOnline = (userId) => {
    const presence = userPresence[userId]
    if (!presence) return false
    
    const lastSeen = new Date(presence.last_seen)
    const now = new Date()
    const diffMinutes = (now - lastSeen) / (1000 * 60)
    
    return presence.is_online && diffMinutes < 2
  }

  // Function to render message status
  const renderMessageStatus = (message) => {
    if (message.user_id !== user.id) return null

    if (message.seen) {
      return <CheckCheck size={16} className="message-status seen" />
    } else if (message.delivered) {
      return <CheckCheck size={16} className="message-status delivered" />
    } else {
      return <Check size={16} className="message-status sent" />
    }
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1 className="chat-title">Chat Room</h1>
        <div className="user-info">
          <span className="user-email">{user?.email}</span>
          <button onClick={handleSignOut} className="logout-btn">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-wrapper ${message.user_id === user.id ? 'own' : 'other'}`}
          >
            <div className={`message-bubble ${message.user_id === user.id ? 'own' : 'other'}`}>
              {message.user_id !== user.id && (
                <div className="message-username">
                  {message.username}
                  {isUserOnline(message.user_id) && (
                    <span className="online-indicator">●</span>
                  )}
                </div>
              )}
              
              {message.content && (
                <div className="message-content">{message.content}</div>
              )}
              
              {message.image_url && (
                <div>
                  <img
                    src={message.image_url}
                    alt="Shared image"
                    className="message-image"
                    onClick={() => window.open(message.image_url, '_blank')}
                  />
                </div>
              )}
              
              <div className="message-footer">
                <div className="message-time">
                  {formatTime(message.created_at)}
                </div>
                {renderMessageStatus(message)}
              </div>
            </div>
          </div>
        ))}
        
        {uploadingImage && (
          <div className="upload-indicator">
            <div className="upload-bubble">
              <div className="upload-text">
                <div className="upload-spinner"></div>
                Uploading image...
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <form onSubmit={sendMessage} className="input-form">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            style={{ display: 'none' }}
          />
          
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="image-upload-btn"
          >
            <Image size={20} />
          </button>
          
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="message-input"
            disabled={loading}
          />
          
          <button
            type="submit"
            disabled={loading || !newMessage.trim()}
            className="send-btn"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  )
}

export default Chat

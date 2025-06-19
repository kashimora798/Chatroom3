import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Send, Image, LogOut, Reply, Check, CheckCheck } from 'lucide-react'

const Chat = () => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [userLastSeen, setUserLastSeen] = useState({})
  const [replyToMessage, setReplyToMessage] = useState(null)
  const [swipeStartX, setSwipeStartX] = useState(null)
  const [swipingMessage, setSwipingMessage] = useState(null)
  
  const { user, signOut } = useAuth()
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const subscriptionRefs = useRef([])
  const heartbeatInterval = useRef(null)
  const visibilityInterval = useRef(null)

  // Cleanup subscriptions
  const cleanupSubscriptions = useCallback(() => {
    subscriptionRefs.current.forEach(sub => {
      if (sub && typeof sub.unsubscribe === 'function') {
        sub.unsubscribe()
      }
    })
    subscriptionRefs.current = []
  }, [])

  useEffect(() => {
    fetchMessages()
    fetchOnlineUsers()
    setupSubscriptions()
    updateUserStatus(true)
    startHeartbeat()
    
    // Handle visibility change
    const handleVisibilityChange = () => {
      if (document.hidden) {
        updateUserStatus(false)
        stopHeartbeat()
      } else {
        updateUserStatus(true)
        startHeartbeat()
        markMessagesAsRead()
      }
    }

    // Handle page unload
    const handleBeforeUnload = () => {
      updateUserStatus(false)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      cleanupSubscriptions()
      updateUserStatus(false)
      stopHeartbeat()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
    markMessagesAsRead()
  }, [messages])

  const startHeartbeat = () => {
    // Send heartbeat every 30 seconds to maintain online status
    heartbeatInterval.current = setInterval(() => {
      if (!document.hidden) {
        updateUserStatus(true)
      }
    }, 30000)
  }

  const stopHeartbeat = () => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const updateUserStatus = async (isOnline) => {
    if (!user) return
    
    try {
      const { error } = await supabase
        .from('user_status')
        .upsert({
          user_id: user.id,
          is_online: isOnline,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) {
        console.error('Error updating user status:', error)
      }
    } catch (err) {
      console.error('Network error updating status:', err)
    }
  }

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        reply_to:reply_to_id(id, content, username, image_url)
      `)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching messages:', error)
    } else {
      setMessages(data || [])
      markMessagesAsDelivered(data || [])
    }
  }

  const fetchOnlineUsers = async () => {
    const { data, error } = await supabase
      .from('user_status')
      .select('user_id, is_online, last_seen, updated_at')

    if (error) {
      console.error('Error fetching online users:', error)
      return
    }

    const online = new Set()
    const lastSeen = {}
    const now = new Date()
    
    data.forEach(status => {
      const lastUpdate = new Date(status.updated_at)
      const timeDiff = now - lastUpdate
      
      // Consider user offline if no update in last 2 minutes
      if (status.is_online && timeDiff < 120000) {
        online.add(status.user_id)
      }
      lastSeen[status.user_id] = status.last_seen
    })

    setOnlineUsers(online)
    setUserLastSeen(lastSeen)
  }

  const markMessagesAsDelivered = async (messages) => {
    const undeliveredMessages = messages.filter(msg => 
      msg.user_id !== user.id
    )

    for (const message of undeliveredMessages) {
      try {
        const { error } = await supabase
          .from('message_status')
          .upsert({
            message_id: message.id,
            user_id: user.id,
            status: 'delivered'
          })
        
        if (!error) {
          // Update message status in database
          await supabase
            .from('messages')
            .update({ status: 'delivered' })
            .eq('id', message.id)
        }
      } catch (err) {
        console.error('Error marking message as delivered:', err)
      }
    }
  }

  const markMessagesAsRead = async () => {
    const unreadMessages = messages.filter(msg => 
      msg.user_id !== user.id && msg.status !== 'read'
    )

    for (const message of unreadMessages) {
      try {
        const { error } = await supabase
          .from('message_status')
          .upsert({
            message_id: message.id,
            user_id: user.id,
            status: 'read'
          })

        if (!error) {
          // Update message status in database
          await supabase
            .from('messages')
            .update({ 
              status: 'read',
              read_at: new Date().toISOString()
            })
            .eq('id', message.id)
        }
      } catch (err) {
        console.error('Error marking message as read:', err)
      }
    }
  }

  const setupSubscriptions = () => {
    // Messages subscription
    const messagesChannel = supabase.channel(`messages-${Date.now()}`)
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          try {
            const { data: completeMessage, error } = await supabase
              .from('messages')
              .select(`
                *,
                reply_to:reply_to_id(id, content, username, image_url)
              `)
              .eq('id', payload.new.id)
              .single()

            if (error) {
              console.error('Error fetching complete message:', error)
              setMessages(prev => [...prev, payload.new])
            } else {
              setMessages(prev => [...prev, completeMessage])
            }
          } catch (err) {
            console.error('Error in message subscription:', err)
            setMessages(prev => [...prev, payload.new])
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages(prev => 
            prev.map(msg => 
              msg.id === payload.new.id ? { ...msg, ...payload.new } : msg
            )
          )
        }
      )
      .subscribe()

    // User status subscription with cleanup of stale users
    const statusChannel = supabase.channel(`user-status-${Date.now()}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_status' },
        () => {
          fetchOnlineUsers()
        }
      )
      .subscribe()

    subscriptionRefs.current = [messagesChannel, statusChannel]

    // Cleanup stale online users every minute
    visibilityInterval.current = setInterval(() => {
      fetchOnlineUsers()
    }, 60000)
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() && !replyToMessage) return

    setLoading(true)

    const messageData = {
      content: newMessage,
      user_id: user.id,
      username: user.email,
      status: 'sent'
    }

    if (replyToMessage) {
      messageData.reply_to_id = replyToMessage.id
    }

    const { error } = await supabase
      .from('messages')
      .insert([messageData])

    if (error) {
      console.error('Error sending message:', error)
    } else {
      setNewMessage('')
      setReplyToMessage(null)
    }
    setLoading(false)
  }

  const uploadImage = async (file) => {
    setUploadingImage(true)
    
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

    const messageData = {
      image_url: data.publicUrl,
      user_id: user.id,
      username: user.email,
      status: 'sent'
    }

    if (replyToMessage) {
      messageData.reply_to_id = replyToMessage.id
    }

    const { error } = await supabase
      .from('messages')
      .insert([messageData])

    if (error) {
      console.error('Error sending image message:', error)
    } else {
      setReplyToMessage(null)
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
    await updateUserStatus(false)
    stopHeartbeat()
    if (visibilityInterval.current) {
      clearInterval(visibilityInterval.current)
    }
    cleanupSubscriptions()
    await signOut()
  }

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatLastSeen = (timestamp) => {
    const now = new Date()
    const lastSeen = new Date(timestamp)
    const diffInMinutes = Math.floor((now - lastSeen) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'just now'
    if (diffInMinutes < 60) return `${diffInMinutes}min ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `${diffInHours}h ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays === 1) return 'yesterday'
    return `${diffInDays} days ago`
  }

  const getMessageStatus = (message) => {
    if (message.user_id === user.id) {
      if (message.status === 'read' || message.read_at) return 'read'
      if (message.status === 'delivered') return 'delivered'
      return 'sent'
    }
    return null
  }

  const renderMessageStatus = (message) => {
    const status = getMessageStatus(message)
    if (!status) return null

    switch (status) {
      case 'sent':
        return <Check size={16} className="message-status single-tick" />
      case 'delivered':
        return <CheckCheck size={16} className="message-status double-tick" />
      case 'read':
        return <CheckCheck size={16} className="message-status double-tick-blue" />
      default:
        return null
    }
  }

  // Touch/swipe handlers
  const handleTouchStart = (e, message) => {
    const touch = e.touches[0]
    setSwipeStartX(touch.clientX)
    setSwipingMessage(message.id)
  }

  const handleTouchMove = (e, message) => {
    if (!swipeStartX || swipingMessage !== message.id) return
    
    const touch = e.touches[0]
    const deltaX = touch.clientX - swipeStartX
    
    if (deltaX > 50) {
      setReplyToMessage(message)
      setSwipeStartX(null)
      setSwipingMessage(null)
    }
  }

  const handleTouchEnd = () => {
    setSwipeStartX(null)
    setSwipingMessage(null)
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1 className="chat-title">Chat Room</h1>
        <div className="online-count">
          <span className="online-dot"></span>
          {onlineUsers.size} online
        </div>
        <div className="user-info">
          <span className="user-email">{user?.email}</span>
          <button onClick={handleSignOut} className="logout-btn">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {replyToMessage && (
        <div className="reply-preview">
          <div className="reply-content">
            <Reply size={16} />
            <div>
              <div className="reply-username">{replyToMessage.username}</div>
              <div className="reply-text">
                {replyToMessage.content || 'Image'}
              </div>
            </div>
          </div>
          <button 
            onClick={() => setReplyToMessage(null)}
            className="cancel-reply"
          >
            ×
          </button>
        </div>
      )}

      <div className="messages-container">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-wrapper ${message.user_id === user.id ? 'own' : 'other'} ${swipingMessage === message.id ? 'swiping' : ''}`}
            onTouchStart={(e) => handleTouchStart(e, message)}
            onTouchMove={(e) => handleTouchMove(e, message)}
            onTouchEnd={handleTouchEnd}
          >
            <div className={`message-bubble ${message.user_id === user.id ? 'own' : 'other'}`}>
              {message.user_id !== user.id && (
                <div className="message-username">
                  {message.username}
                  <span className={`online-indicator ${onlineUsers.has(message.user_id) ? 'online' : 'offline'}`}>
                    {onlineUsers.has(message.user_id) ? (
                      <>
                        <span className="online-dot"></span>
                        online
                      </>
                    ) : (
                      <>
                        <span className="offline-dot"></span>
                        {userLastSeen[message.user_id] 
                          ? formatLastSeen(userLastSeen[message.user_id])
                          : 'offline'
                        }
                      </>
                    )}
                  </span>
                </div>
              )}

              {message.reply_to && (
                <div className="reply-reference">
                  <div className="reply-bar"></div>
                  <div>
                    <div className="reply-ref-username">{message.reply_to.username}</div>
                    <div className="reply-ref-content">
                      {message.reply_to.content || 'Image'}
                    </div>
                  </div>
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
            disabled={loading || (!newMessage.trim() && !replyToMessage)}
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

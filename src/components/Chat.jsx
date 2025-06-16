import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Send, Image, LogOut } from 'lucide-react'

const Chat = () => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const { user, signOut } = useAuth()
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const subscriptionRef = useRef(null)

  useEffect(() => {
    fetchMessages()
    subscribeToMessages()

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching messages:', error)
    } else {
      setMessages(data || [])
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

    const { error } = await supabase
      .from('messages')
      .insert([
        {
          content: newMessage,
          user_id: user.id,
          username: user.email,
        }
      ])

    if (error) {
      console.error('Error sending message:', error)
    } else {
      setNewMessage('')
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

    const { error } = await supabase
      .from('messages')
      .insert([
        {
          image_url: data.publicUrl,
          user_id: user.id,
          username: user.email,
        }
      ])

    if (error) {
      console.error('Error sending image message:', error)
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
                <div className="message-username">{message.username}</div>
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
              
              <div className="message-time">
                {formatTime(message.created_at)}
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
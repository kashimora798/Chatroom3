import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Send, Image, LogOut, Reply, Check, CheckCheck, Users, X, Search, Settings, Plus, Smile, Paperclip, Mic, MoreVertical } from 'lucide-react'

const formatDateSeparator = (date) => {
  const messageDate = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  // Reset time to compare only dates
  const resetTime = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  
  const messageDateReset = resetTime(messageDate)
  const todayReset = resetTime(today)
  const yesterdayReset = resetTime(yesterday)
  
  if (messageDateReset.getTime() === todayReset.getTime()) {
    return 'Today'
  } else if (messageDateReset.getTime() === yesterdayReset.getTime()) {
    return 'Yesterday'
  } else {
    return messageDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }
}

const isSameDay = (date1, date2) => {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate()
}

const shouldShowDateSeparator = (currentMessage, previousMessage) => {
  if (!previousMessage) return true
  return !isSameDay(currentMessage.created_at, previousMessage.created_at)
}
const Chat = () => {
  
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [userLastSeen, setUserLastSeen] = useState({})
  const [allUsers, setAllUsers] = useState([])
  const [showUsersModal, setShowUsersModal] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState(null)
  const [selectedMessages, setSelectedMessages] = useState(new Set())
  const [swipeStartX, setSwipeStartX] = useState(null)
  const [swipingMessage, setSwipingMessage] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [typingUsers, setTypingUsers] = useState(new Map())
  const [typingTimeout, setTypingTimeout] = useState(null)
  const [currentlyTyping, setCurrentlyTyping] = useState(false)
  
  const { user, signOut } = useAuth()
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const subscriptionRefs = useRef([])
  const lastActivityRef = useRef(Date.now())

  // Early return if user is not authenticated
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }
const DateSeparator = ({ date }) => (
  <div className="flex items-center justify-center my-6">
    <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
    <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-full border border-gray-300 dark:border-gray-600">
      {formatDateSeparator(date)}
    </div>
    <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
  </div>
)
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
    if (!user) return // Guard against null user
    
    fetchMessages()
    fetchAllUsers()
    fetchOnlineUsers()
    setupSubscriptions()
    updateUserStatus(true)
    
    const activityInterval = setInterval(() => {
      updateUserStatus(true)
    }, 30000)

    const handleVisibilityChange = () => {
      if (document.hidden) {
        updateUserStatus(false)
      } else {
        updateUserStatus(true)
        markMessagesAsRead()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cleanupSubscriptions()
      updateUserStatus(false)
      clearInterval(activityInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user]) // Add user as dependency

  useEffect(() => {
    scrollToBottom()
    markMessagesAsRead()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const updateUserStatus = async (isOnline) => {
    if (!user) return
    
    try {
      const { error } = await supabase.rpc('update_user_status', {
        p_user_id: user.id,
        p_is_online: isOnline,
        p_last_seen: new Date().toISOString()
      })

      if (error) {
        console.error('Error updating user status:', error)
      }
    } catch (err) {
      console.error('Unexpected error updating user status:', err)
    }
  }

  const fetchAllUsers = async () => {
    if (!user) return
    
    const { data, error } = await supabase
      .from('user_status')
      .select('user_id, is_online, last_seen, updated_at')

    if (error) {
      console.error('Error fetching all users:', error)
      return
    }

    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .select('user_id, username')

    if (messagesError) {
      console.error('Error fetching user emails:', messagesError)
      return
    }

    const userMap = {}
    messagesData.forEach(msg => {
      if (!userMap[msg.user_id] && msg.username) {
        userMap[msg.user_id] = msg.username
      }
    })

    const usersWithStatus = data.map(status => ({
      ...status,
      username: userMap[status.user_id] || 'Unknown User'
    }))

    setAllUsers(usersWithStatus)
  }

  const fetchMessages = async () => {
    if (!user) return
    
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        reply_to:reply_to_id(id, content, username, image_url),
        message_status(status, user_id)
      `)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching messages:', error)
    } else {
      // Process messages with status information
      const processedMessages = (data || []).map(message => {
        // Ensure username exists
        if (!message.username) {
          message.username = 'Unknown User'
        }
        
        // Get status for messages sent by current user
        if (message.user_id === user.id) {
          const statuses = message.message_status || []
          const readStatuses = statuses.filter(s => s.status === 'read')
          const deliveredStatuses = statuses.filter(s => s.status === 'delivered')
          
          let computed_status = 'sent'
          if (readStatuses.length > 0) {
            computed_status = 'read'
          } else if (deliveredStatuses.length > 0) {
            computed_status = 'delivered'
          }
          
          return {
            ...message,
            computed_status
          }
        }
        return message
      })
      
      setMessages(processedMessages)
      markMessagesAsDelivered(processedMessages)
    }
  }

  const fetchOnlineUsers = async () => {
    const { data, error } = await supabase
      .from('user_status')
      .select('user_id, is_online, last_seen')

    if (error) {
      console.error('Error fetching online users:', error)
      return
    }

    const online = new Set()
    const lastSeen = {}
    
    data.forEach(status => {
      if (status.is_online) {
        online.add(status.user_id)
      }
      lastSeen[status.user_id] = status.last_seen
    })

    setOnlineUsers(online)
    setUserLastSeen(lastSeen)
  }

  const markMessagesAsDelivered = async (messages) => {
    if (!user) return
    
    const undeliveredMessages = messages.filter(msg => {
      if (msg.user_id === user.id) return false // Don't mark own messages
      
      const statuses = msg.message_status || []
      const hasDelivered = statuses.some(s => s.user_id === user.id && (s.status === 'delivered' || s.status === 'read'))
      
      return !hasDelivered
    })

    for (const message of undeliveredMessages) {
      try {
        await supabase
          .from('message_status')
          .upsert({
            message_id: message.id,
            user_id: user.id,
            status: 'delivered'
          }, {
            onConflict: 'message_id,user_id'
          })
      } catch (error) {
        console.error('Error marking message as delivered:', error)
      }
    }
  }

  const markMessagesAsRead = async () => {
    if (!user) return
    
    const unreadMessages = messages.filter(msg => {
      if (msg.user_id === user.id) return false // Don't mark own messages
      
      const statuses = msg.message_status || []
      const hasRead = statuses.some(s => s.user_id === user.id && s.status === 'read')
      
      return !hasRead
    })

    for (const message of unreadMessages) {
      try {
        await supabase
          .from('message_status')
          .upsert({
            message_id: message.id,
            user_id: user.id,
            status: 'read'
          }, {
            onConflict: 'message_id,user_id'
          })
      } catch (error) {
        console.error('Error marking message as read:', error)
      }
    }
  }

  // Handle typing status changes
  const handleTypingStatusChange = (payload) => {
    const { user_id, username, is_typing } = payload.new || payload.old
    
    if (user_id === user.id) return // Don't show own typing
    
    setTypingUsers(prev => {
      const newTypingUsers = new Map(prev)
      if (is_typing) {
        newTypingUsers.set(user_id, { username: username || 'Unknown User', timestamp: Date.now() })
      } else {
        newTypingUsers.delete(user_id)
      }
      return newTypingUsers
    })
  }

  // Handle message status changes for read receipts
  const handleMessageStatusChange = (payload) => {
    console.log('Message status changed:', payload)
    const { message_id, status, user_id } = payload.new || {}
    
    // Only update if it's not the current user's own status change
    if (user_id !== user.id) {
      setMessages(prev => prev.map(msg => {
        if (msg.id === message_id && msg.user_id === user.id) {
          // Update the computed status based on the new status
          const currentStatuses = msg.message_status || []
          
          // Add or update the status for this user
          const updatedStatuses = currentStatuses.filter(s => s.user_id !== user_id)
          updatedStatuses.push({ status, user_id })
          
          // Recompute status
          const readStatuses = updatedStatuses.filter(s => s.status === 'read')
          const deliveredStatuses = updatedStatuses.filter(s => s.status === 'delivered')
          
          let computed_status = 'sent'
          if (readStatuses.length > 0) {
            computed_status = 'read'
          } else if (deliveredStatuses.length > 0) {
            computed_status = 'delivered'
          }
          
          return {
            ...msg,
            message_status: updatedStatuses,
            computed_status,
            [`${status}_at`]: new Date().toISOString()
          }
        }
        return msg
      }))
    }
  }

  // Mark message as delivered
  const markMessageAsDelivered = async (messageId) => {
    if (!user) return
    
    await supabase
      .from('message_status')
      .upsert({
        message_id: messageId,
        user_id: user.id,
        status: 'delivered'
      })
  }

  // Handle typing indicator
  const handleTypingStart = async () => {
    if (!user || !currentlyTyping) {
      setCurrentlyTyping(true)
      await supabase
        .from('typing_status')
        .upsert({
          user_id: user.id,
          username: user.email || 'Unknown User',
          is_typing: true,
          updated_at: new Date().toISOString()
        })
    }
  }

  const handleTypingStop = async () => {
    if (user && currentlyTyping) {
      setCurrentlyTyping(false)
      await supabase
        .from('typing_status')
        .upsert({
          user_id: user.id,
          username: user.email || 'Unknown User',
          is_typing: false,
          updated_at: new Date().toISOString()
        })
    }
  }

  // Debounced typing handler
  const handleInputChange = (e) => {
    setNewMessage(e.target.value)
    
    // Start typing indicator
    handleTypingStart()
    
    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }
    
    // Set new timeout to stop typing after 2 seconds of inactivity
    const newTimeout = setTimeout(() => {
      handleTypingStop()
    }, 2000)
    
    setTypingTimeout(newTimeout)
  }

  const setupSubscriptions = () => {
    if (!user) return
    
    const messagesChannel = supabase.channel(`messages-${Date.now()}`)
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          try {
            const { data: completeMessage, error } = await supabase
              .from('messages')
              .select(`
                *,
                reply_to:reply_to_id(id, content, username, image_url),
                message_status(status, user_id)
              `)
              .eq('id', payload.new.id)
              .single()

            if (error) {
              console.error('Error fetching complete message:', error)
              // Fallback to basic message
              const basicMessage = {
                ...payload.new,
                username: payload.new.username || 'Unknown User',
                computed_status: payload.new.user_id === user.id ? 'sent' : null,
                message_status: []
              }
              setMessages(prev => [...prev, basicMessage])
            } else {
              // Ensure username exists
              if (!completeMessage.username) {
                completeMessage.username = 'Unknown User'
              }
              
              // Process the complete message
              let processedMessage = completeMessage
              if (completeMessage.user_id === user.id) {
                const statuses = completeMessage.message_status || []
                const readStatuses = statuses.filter(s => s.status === 'read')
                const deliveredStatuses = statuses.filter(s => s.status === 'delivered')
                
                let computed_status = 'sent'
                if (readStatuses.length > 0) {
                  computed_status = 'read'
                } else if (deliveredStatuses.length > 0) {
                  computed_status = 'delivered'
                }
                
                processedMessage = {
                  ...completeMessage,
                  computed_status
                }
              }
              
              setMessages(prev => [...prev, processedMessage])
              
              // Mark message as delivered for other users
              if (completeMessage.user_id !== user.id) {
                await markMessageAsDelivered(completeMessage.id)
              }
            }
          } catch (err) {
            console.error('Error in message subscription:', err)
            // Fallback
            const basicMessage = {
              ...payload.new,
              username: payload.new.username || 'Unknown User',
              computed_status: payload.new.user_id === user.id ? 'sent' : null,
              message_status: []
            }
            setMessages(prev => [...prev, basicMessage])
          }
        }
      )
      .subscribe()

    // Update the user status change handler
    const statusChannel = supabase.channel(`user-status-${Date.now()}`)
      .on('postgres_changes',
        { 
          event: '*',
          schema: 'public', 
          table: 'user_status' 
        },
        (payload) => {
          console.log('User status changed:', payload)
          fetchOnlineUsers()
          fetchAllUsers()
          
          // When a user comes online, mark unread messages as read
          if (payload.eventType === 'UPDATE' && payload.new.is_online && payload.old?.is_online === false) {
            console.log('User came online, marking messages as read')
            setTimeout(() => {
              markMessagesAsRead()
            }, 1000) // Small delay to ensure UI is ready
          }
        }
      )
      .subscribe()

    // Add typing status subscription
    const typingChannel = supabase.channel(`typing-status-${Date.now()}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'typing_status'
        },
        (payload) => {
          handleTypingStatusChange(payload)
        }
      )
      .subscribe()

    // Add message status subscription for read receipts
    const messageStatusChannel = supabase.channel(`message-status-${Date.now()}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_status'
        },
        (payload) => {
          handleMessageStatusChange(payload)
        }
      )
      .subscribe()

    subscriptionRefs.current = [messagesChannel, statusChannel, typingChannel, messageStatusChannel]
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() && !replyToMessage) return
    if (!user) return

    setLoading(true)

    const messageData = {
      content: newMessage,
      user_id: user.id,
      username: user.email || 'Unknown User',
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
    if (!user) return
    
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
      username: user.email || 'Unknown User',
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
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `${diffInHours}h ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays}d ago`
  }

  const getMessageStatus = (message) => {
    if (message.user_id === user.id) {
      // Use computed status if available, otherwise fall back to existing logic
      if (message.computed_status) {
        return message.computed_status
      }
      
      if (message.read_at) return 'read'
      if (message.delivered_at || message.status === 'delivered') return 'delivered'
      return 'sent'
    }
    return null
  }

  useEffect(() => {
    return () => {
      // Clear typing timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout)
      }
      // Stop typing when component unmounts
      if (currentlyTyping) {
        handleTypingStop()
      }
      cleanupSubscriptions()
      updateUserStatus(false)
    }
  }, [])

  const renderMessageStatus = (message) => {
    const status = getMessageStatus(message)
    if (!status) return null

    switch (status) {
      case 'sent':
        return (
          <div className="status-indicator status-sent">
            <Check size={16} />
          </div>
        )
      case 'delivered':
        return (
          <div className="status-indicator status-delivered double-check">
            <CheckCheck size={16} />
          </div>
        )
      case 'read':
        return (
          <div className="status-indicator status-read status-read-pulse">
            <CheckCheck size={16} className="text-green-500" />
          </div>
        )
      default:
        return null
    }
  }

  // Add this component for debugging status changes
  const StatusDebugger = ({ message }) => {
    const status = getMessageStatus(message)
    
    if (process.env.NODE_ENV === 'development' && message.user_id === user.id) {
      return (
        <div className="text-xs text-gray-400 mt-1">
          Status: {status} | DB Status: {message.status} | Computed: {message.computed_status}
        </div>
      )
    }
    return null
  }

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

  // Helper function to safely get username
  const getSafeUsername = (username) => {
    return username && username.trim() ? username : 'Unknown User'
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar - Desktop */}
      <div className={`hidden lg:flex lg:flex-col lg:w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ${sidebarOpen ? 'lg:w-80' : 'lg:w-16'}`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className={`flex items-center space-x-3 ${!sidebarOpen && 'justify-center'}`}>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <span className="font-bold text-white">C</span>
              </div>
              {sidebarOpen && (
                <div>
                  <h1 className="font-bold text-gray-900 dark:text-white">Chat Room</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{onlineUsers.size} online</p>
                </div>
              )}
            </div>
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <MoreVertical size={18} className="text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Search */}
        {sidebarOpen && (
          <div className="p-4">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-100 dark:bg-gray-700 border-0 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600 transition-all"
              />
            </div>
          </div>
        )}

        {/* Users List */}
        <div className="flex-1 overflow-y-auto">
          {sidebarOpen ? (
            <div className="px-2">
              {allUsers.map((userStatus) => (
                <div 
                  key={userStatus.user_id} 
                  className="flex items-center space-x-3 p-3 mx-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl cursor-pointer transition-all group"
                >
                  <div className="relative">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <span className="font-semibold text-white text-sm">
                        {getSafeUsername(userStatus.username).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${
                      onlineUsers.has(userStatus.user_id) ? 'bg-green-500' : 'bg-gray-400'
                    }`}></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {getSafeUsername(userStatus.username)}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {onlineUsers.has(userStatus.user_id) ? (
                        <span className="text-green-600 dark:text-green-400">Online</span>
                      ) : (
                        <span>Last seen {formatLastSeen(userStatus.last_seen)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 space-y-2">
              {allUsers.slice(0, 8).map((userStatus) => (
                <div key={userStatus.user_id} className="flex justify-center">
                  <div className="relative">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <span className="font-semibold text-white text-xs">
                        {getSafeUsername(userStatus.username).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${
                      onlineUsers.has(userStatus.user_id) ? 'bg-green-500' : 'bg-gray-400'
                    }`}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      

        {/* Sidebar Footer */}
        {sidebarOpen && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="font-semibold text-white text-sm">
                    {user?.email?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white truncate">
                    {user?.email}
                  </div>
                  <div className="text-sm text-green-600 dark:text-green-400">Online</div>
                </div>
              </div>
              <button 
                onClick={handleSignOut}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors group"
              >
                <LogOut size={18} className="text-gray-600 dark:text-gray-400 group-hover:text-red-500" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <div className="lg:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setShowUsersModal(true)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
              >
                <Users size={20} className="text-gray-600 dark:text-gray-400" />
              </button>
              <div>
                <h1 className="font-bold text-gray-900 dark:text-white">Chat Room</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{onlineUsers.size} online</p>
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
            >
              <LogOut size={18} className="text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:block bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
                  <span className="font-bold text-white">#</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">General Chat</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {onlineUsers.size} members online
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                <Search size={18} className="text-gray-600 dark:text-gray-400" />
              </button>
              <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                <Settings size={18} className="text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Reply Preview */}
        {replyToMessage && (
          <div className="mx-4 lg:mx-6 mt-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-1 h-8 bg-blue-500 rounded-full"></div>
                <div>
                  <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Replying to {replyToMessage.username}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-md">
                    {replyToMessage.content || 'Image'}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setReplyToMessage(null)}
                className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
              >
                <X size={16} className="text-blue-500 dark:text-blue-400" />
              </button>
            </div>
          </div>
        )}

        {/* Messages Container */}
        {messages.map((message, index) => {
  const showAvatar = index === 0 || messages[index - 1].user_id !== message.user_id
  const isOwn = message.user_id === user.id
  const previousMessage = index > 0 ? messages[index - 1] : null
  const showDateSeparator = shouldShowDateSeparator(message, previousMessage)
  
  return (
    <React.Fragment key={message.id}>
      {/* Date Separator */}
      {showDateSeparator && (
        <DateSeparator date={message.created_at} />
      )}
      
      <div
        className={`flex items-end space-x-3 ${isOwn ? 'flex-row-reverse space-x-reverse' : ''}`}
        onTouchStart={(e) => handleTouchStart(e, message)}
                onTouchMove={(e) => handleTouchMove(e, message)}
                onTouchEnd={handleTouchEnd}
              >
                {/* Avatar */}
                <div className={`flex flex-col items-center ${showAvatar ? 'opacity-100' : 'opacity-0'}`}>
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                    <span className="font-semibold text-white text-xs">
                      {message.username.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Message Content */}
                <div className={`flex flex-col max-w-md lg:max-w-lg ${isOwn ? 'items-end' : 'items-start'}`}>
                  {/* Username & Time */}
                  {showAvatar && !isOwn && (
                    <div className="flex items-center space-x-2 mb-1 px-1">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {message.username}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatTime(message.created_at)}
                      </span>
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div className={`relative px-4 py-3 rounded-2xl shadow-sm ${
                    isOwn
                      ? 'bg-blue-500 text-white rounded-br-md'
                      : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md'
                  }`}>
                    {/* Reply Reference */}
                    {message.reply_to && (
                      <div className={`mb-2 p-2 rounded-lg border-l-4 ${
                        isOwn 
                          ? 'bg-blue-600 border-blue-300' 
                          : 'bg-gray-100 dark:bg-gray-600 border-gray-300 dark:border-gray-500'
                      }`}>
                        <div className={`text-xs font-semibold ${
                          isOwn ? 'text-blue-100' : 'text-gray-600 dark:text-gray-300'
                        }`}>
                          {message.reply_to.username}
                        </div>
                        <div className={`text-sm ${
                          isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {message.reply_to.content || 'Image'}
                        </div>
                      </div>
                    )}
                    
                    {/* Message Text */}
                    {message.content && (
                      <div className="leading-relaxed">
                        {message.content}
                      </div>
                    )}
                    
                    {/* Message Image */}
                    {message.image_url && (
                      <div className="mt-2">
                        <img
                          src={message.image_url}
                          alt="Shared image"
                          className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(message.image_url, '_blank')}
                        />
                      </div>
                    )}
                  </div>

                  {/* Own message time & status */}
               {/* Own message time & status */}
{isOwn && (
  <div className="flex items-center space-x-1 mt-1 px-1">
    <span className="text-xs text-gray-500 dark:text-gray-400">
      {formatTime(message.created_at)}
    </span>
    {renderMessageStatus(message)}
    <StatusDebugger message={message} />
  </div>
)}
                </div>
              </div>
    </React.Fragment>
  )
})}
          
          {/* Typing Indicator */}
          {/* Enhanced Typing Indicator */}
{typingUsers.size > 0 && (
  <div className="flex items-end space-x-3">
    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
      <span className="text-xs font-semibold text-gray-600">
        {Array.from(typingUsers.values())[0].username.charAt(0).toUpperCase()}
      </span>
    </div>
    <div className="bg-gray-200 dark:bg-gray-700 px-4 py-3 rounded-2xl rounded-bl-md">
      <div className="flex items-center space-x-2">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
        </div>
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {typingUsers.size === 1 
            ? `${Array.from(typingUsers.values())[0].username} is typing...`
            : `${typingUsers.size} people are typing...`
          }
        </span>
      </div>
    </div>
  </div>
)}
          
          {/* Upload Indicator */}
          {uploadingImage && (
            <div className="flex justify-end">
              <div className="bg-blue-500 text-white px-4 py-3 rounded-2xl rounded-br-md">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Uploading image...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Enhanced Input Container */}
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 lg:p-6">
          <form onSubmit={sendMessage} className="flex items-end space-x-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*,video/*,application/*"
              className="hidden"
            />
            
            {/* Left Actions */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="p-3 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-all disabled:opacity-50"
              >
                <Paperclip size={20} />
              </button>
              <button
                type="button"
                className="p-3 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-all lg:block hidden"
              >
                <Image size={20} />
              </button>
            </div>
            
            {/* Message Input */}
            <div className="flex-1 relative">
             
              <input
  type="text"
  value={newMessage}
  onChange={handleInputChange} // Changed from (e) => setNewMessage(e.target.value)
  placeholder="Type a message..."
  className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-0 rounded-2xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600 transition-all resize-none"
  disabled={loading}
/>
              <button
                type="button"
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors lg:block hidden"
              >
                <Smile size={18} />
              </button>
            </div>
            
            {/* Send/Voice Button */}
            <div className="flex items-center space-x-2">
              {newMessage.trim() || replyToMessage ? (
                <button
                  type="submit"
                  disabled={loading}
                  className="p-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
                >
                  <Send size={20} />
                </button>
              ) : (
                <button
                  type="button"
                  className="p-3 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-all"
                >
                  <Mic size={20} />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
)
      {/* Mobile Users Modal */}
      {showUsersModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 lg:hidden">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Online Users</h2>
              <button 
                onClick={() => setShowUsersModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto">
              {allUsers.map((userStatus) => (
                <div key={userStatus.user_id} className="flex items-center space-x-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
                  <div className="relative">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <span className="font-semibold text-white">
                        {userStatus.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${
                      onlineUsers.has(userStatus.user_id) ? 'bg-green-500' : 'bg-gray-400'
                    }`}></div>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">{userStatus.username}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {onlineUsers.has(userStatus.user_id) ? (
                        <span className="text-green-600 dark:text-green-400">Online</span>
                      ) : (
                        <span>Last seen {formatLastSeen(userStatus.last_seen)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Chat

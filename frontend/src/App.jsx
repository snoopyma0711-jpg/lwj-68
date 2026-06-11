import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Login from './pages/Login'
import InspectorTasks from './pages/InspectorTasks'
import TaskExecute from './pages/TaskExecute'
import TemplateManagement from './pages/TemplateManagement'
import WorkOrders from './pages/WorkOrders'
import Dashboard from './pages/Dashboard'
import AppLayout from './components/AppLayout'

function PrivateRoute({ children, allowedRoles }) {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'supervisor' ? '/dashboard' : '/tasks'} replace />
  }
  return children
}

function App() {
  const [user, setUser] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const u = localStorage.getItem('user')
    if (u) setUser(JSON.parse(u))
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    navigate('/login', { replace: true })
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={(u) => setUser(u)} />} />
      <Route
        path="/tasks"
        element={
          <PrivateRoute allowedRoles={['inspector', 'supervisor']}>
            <AppLayout user={user} onLogout={handleLogout}>
              <InspectorTasks user={user} />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <PrivateRoute allowedRoles={['inspector', 'supervisor']}>
            <AppLayout user={user} onLogout={handleLogout}>
              <TaskExecute user={user} />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <PrivateRoute allowedRoles={['supervisor']}>
            <AppLayout user={user} onLogout={handleLogout}>
              <TemplateManagement />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/work-orders"
        element={
          <PrivateRoute allowedRoles={['supervisor']}>
            <AppLayout user={user} onLogout={handleLogout}>
              <WorkOrders />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute allowedRoles={['supervisor']}>
            <AppLayout user={user} onLogout={handleLogout}>
              <Dashboard />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="*"
        element={
          <Navigate to={
            user
              ? (user.role === 'supervisor' ? '/dashboard' : '/tasks')
              : '/login'
          } replace />
        }
      />
    </Routes>
  )
}

export default App

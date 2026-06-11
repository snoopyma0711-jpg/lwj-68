import React from 'react'
import { Layout, Menu, Dropdown, Avatar } from 'antd'
import {
  DashboardOutlined,
  FileTextOutlined,
  FormOutlined,
  ToolOutlined,
  LogoutOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

export default function AppLayout({ user, children, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()

  const menuItems = []
  if (user?.role === 'supervisor') {
    menuItems.push(
      { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
      { key: '/templates', icon: <FileTextOutlined />, label: '巡检模板' },
      { key: '/work-orders', icon: <ToolOutlined />, label: '维修工单' },
      { key: '/tasks', icon: <FormOutlined />, label: '巡检任务' }
    )
  } else {
    menuItems.push(
      { key: '/tasks', icon: <FormOutlined />, label: '我的巡检任务' }
    )
  }

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' }
    ],
    onClick: ({ key }) => {
      if (key === 'logout') onLogout()
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220}>
        <div style={{
          height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 16, fontWeight: 'bold', borderBottom: '1px solid #333'
        }}>
          设备巡检系统
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Dropdown menu={userMenu}>
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.name}</span>
              <span style={{ color: '#888', fontSize: 12 }}>
                ({user?.role === 'supervisor' ? '主管' : '巡检员'})
              </span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: '#fff', minHeight: 'calc(100vh - 120px)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

import React, { useState, useEffect } from 'react'
import { Table, Tag, Button, Space, DatePicker } from 'antd'
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../api'

const statusMap = {
  pending: { color: 'orange', text: '待执行' },
  in_progress: { color: 'blue', text: '进行中' },
  completed: { color: 'green', text: '已完成' }
}

export default function InspectorTasks({ user }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(dayjs())
  const navigate = useNavigate()

  const loadTasks = async () => {
    setLoading(true)
    try {
      const data = await api.get('/tasks', { params: { date: date.format('YYYY-MM-DD') } })
      setTasks(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [date])

  const columns = [
    { title: '任务ID', dataIndex: 'id', width: 80 },
    { title: '任务名称', dataIndex: 'template_name' },
    {
      title: '巡检日期',
      dataIndex: 'task_date',
      width: 120,
      render: (v) => dayjs(v).format('YYYY-MM-DD')
    },
    ...(user?.role === 'supervisor' ? [
      { title: '指派巡检员', dataIndex: 'assigned_user_name', width: 120 }
    ] : []),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.text}</Tag>
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => navigate(`/tasks/${record.id}`)}
          >
            查看/执行
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          {user?.role === 'supervisor' ? '巡检任务管理' : '我的巡检任务'}
        </h2>
        <Space>
          <DatePicker value={date} onChange={setDate} allowClear={false} />
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>刷新</Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        loading={loading}
        pagination={false}
      />
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { Card, Statistic, Row, Col, Progress, List, Tag, Empty, Spin, Space, Typography, Divider, Button, Table } from 'antd'
import {
  CheckSquareOutlined, ToolOutlined, WarningOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import api from '../api'

const { Title, Text } = Typography
const COLORS = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2']

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadStats = async () => {
    setLoading(true)
    try {
      const data = await api.get('/stats/dashboard')
      setStats(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStats()
  }, [])

  if (loading || !stats) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', padding: 100 }} />

  const topDeviceChartData = stats.topAbnormalDevices.map(d => ({
    name: d.name.length > 8 ? d.name.slice(0, 8) + '...' : d.name,
    fullName: d.name,
    code: d.code,
    异常数: d.abnormal_count,
    line: d.line_name
  }))

  const pieData = stats.lineAbnormalStats.map(l => ({
    name: l.name || '未分类',
    value: l.abnormal_count
  }))

  const completionData = [
    { name: '已完成', value: stats.completedTasks, color: '#52c41a' },
    { name: '未完成', value: stats.pendingTasks, color: '#faad14' }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>数据仪表盘</h2>
          <Text type="secondary">统计周期：{stats.weekRange.start} ~ {stats.weekRange.end}</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadStats}>刷新数据</Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="本周巡检完成率"
              value={stats.completionRate}
              suffix="%"
              prefix={<CheckSquareOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: stats.completionRate >= 80 ? '#52c41a' : stats.completionRate >= 50 ? '#faad14' : '#ff4d4f' }}
            />
            <Progress
              percent={stats.completionRate}
              status={stats.completionRate >= 80 ? 'success' : stats.completionRate >= 50 ? 'normal' : 'exception'}
              showInfo={false}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              已完成 {stats.completedTasks} / 共 {stats.totalTasks} 项任务
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="当前未关闭工单"
              value={stats.openWorkOrders}
              prefix={<ToolOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: stats.openWorkOrders > 0 ? '#faad14' : '#52c41a' }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ color: '#faad14' }}><WarningOutlined /> 待处理：{stats.openWorkOrders}</span>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已完成任务数"
              value={stats.completedTasks}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
            <Progress type="dashboard" percent={stats.totalTasks ? Math.round(stats.completedTasks / stats.totalTasks * 100) : 0} size={70} style={{ position: 'absolute', right: 16, top: 16 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="待完成任务数"
              value={stats.pendingTasks}
              prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: stats.pendingTasks > 0 ? '#faad14' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card title={<Title level={5} style={{ margin: 0 }}>本周异常设备 TOP 5</Title>}>
            {topDeviceChartData.length > 0 ? (
              <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDeviceChartData} layout="vertical" margin={{ left: 20, right: 30, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={100} />
                    <Tooltip
                      formatter={(value, name, props) => [value, name]}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="异常数" fill="#ff4d4f" radius={[0, 4, 4, 0]}>
                      {topDeviceChartData.map((entry, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="本周暂无异常记录" />
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card title={<Title level={5} style={{ margin: 0 }}>各产线异常分布</Title>}>
            {pieData.length > 0 && pieData.reduce((s, d) => s + d.value, 0) > 0 ? (
              <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={90}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="本周暂无异常记录" />
            )}
          </Card>
        </Col>
      </Row>

      <Card title={<Title level={5} style={{ margin: 0 }}>本周异常设备排行详情</Title>}>
        {stats.topAbnormalDevices.length > 0 ? (
          <Table
            size="small"
            dataSource={stats.topAbnormalDevices}
            rowKey="id"
            pagination={false}
            columns={[
              { title: '排名', width: 80, render: (_, __, idx) => <Tag color={idx === 0 ? 'red' : idx === 1 ? 'orange' : idx === 2 ? 'gold' : 'blue'}>#{idx + 1}</Tag> },
              { title: '设备名称', dataIndex: 'name' },
              { title: '设备编号', dataIndex: 'code', width: 140 },
              { title: '所属产线', dataIndex: 'line_name', width: 140, render: v => <Tag>{v}</Tag> },
              { title: '异常项数量', dataIndex: 'abnormal_count', width: 120, render: v => <Text strong style={{ color: '#ff4d4f' }}>{v} 项</Text> }
            ]}
          />
        ) : (
          <Empty description="本周暂无异常设备" />
        )}
      </Card>
    </div>
  )
}

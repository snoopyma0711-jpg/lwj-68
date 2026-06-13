import React, { useState, useEffect } from 'react'
import {
  Table, Tag, Button, Space, Modal, Input, Select, Descriptions,
  Image, Timeline, message, Badge, Typography, Divider, Row, Col, Card,
  InputNumber, Popconfirm, Empty
} from 'antd'
import {
  UserOutlined, ReloadOutlined, ToolOutlined, CheckCircleOutlined,
  CheckSquareOutlined, EyeOutlined, ClockCircleOutlined, CloseOutlined,
  StopOutlined, PlusOutlined, DeleteOutlined, WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../api'

const { Text, Title } = Typography

const statusConfig = {
  pending: { color: 'orange', text: '待分配', icon: <ClockCircleOutlined /> },
  in_progress: { color: 'blue', text: '维修中', icon: <ToolOutlined /> },
  completed: { color: 'purple', text: '已完成', icon: <CheckSquareOutlined /> },
  accepted: { color: 'green', text: '已验收', icon: <CheckCircleOutlined /> },
  cancelled: { color: 'default', text: '已取消', icon: <CloseOutlined /> },
  rejected: { color: 'red', text: '已驳回', icon: <StopOutlined /> }
}

const defaultStatusConfig = { color: 'default', text: '未知', icon: <ClockCircleOutlined /> }

export default function WorkOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState()
  const [detailVisible, setDetailVisible] = useState(false)
  const [currentOrder, setCurrentOrder] = useState(null)
  const [assignVisible, setAssignVisible] = useState(false)
  const [assigneeName, setAssigneeName] = useState('')
  const [spareParts, setSpareParts] = useState([])
  const [selectedParts, setSelectedParts] = useState([])
  const [sparePartsLoading, setSparePartsLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await api.get('/work-orders', { params: { status: statusFilter } })
      setOrders(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [statusFilter])

  const viewDetail = async (order) => {
    setCurrentOrder(order)
    setDetailVisible(true)
  }

  const openAssign = async (order) => {
    setCurrentOrder(order)
    setAssigneeName(order.assignee_name || '')
    setSelectedParts([])
    setAssignVisible(true)
    setSparePartsLoading(true)
    try {
      const data = await api.get('/spare-parts')
      setSpareParts(data)
    } catch (e) {
    } finally {
      setSparePartsLoading(false)
    }
  }

  const addSelectedPart = () => {
    setSelectedParts(prev => [...prev, { spare_part_id: null, quantity: 1 }])
  }

  const removeSelectedPart = (idx) => {
    setSelectedParts(prev => prev.filter((_, i) => i !== idx))
  }

  const updateSelectedPart = (idx, field, value) => {
    setSelectedParts(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const handleAssign = async () => {
    if (!assigneeName.trim()) {
      message.warning('请输入维修人员姓名')
      return
    }
    const validParts = selectedParts.filter(p => p.spare_part_id && p.quantity > 0)
    try {
      const payload = { assignee_name: assigneeName.trim() }
      if (validParts.length > 0) {
        payload.spare_parts = validParts
      }
      await api.put(`/work-orders/${currentOrder.id}/assign`, payload)
      message.success('已指派维修人员')
      setAssignVisible(false)
      loadData()
    } catch (e) {
      const errData = e.response?.data
      if (errData?.shortages) {
        const lines = errData.shortages.map(s =>
          `${s.name}(${s.spec_model}): 需求${s.required}, 库存${s.current_stock}, 缺${s.shortfall}`
        )
        message.error({ content: lines.join('\n'), duration: 6 })
      }
    }
  }

  const handleComplete = async (order) => {
    try {
      await api.put(`/work-orders/${order.id}/complete`)
      message.success('已标记完成')
      loadData()
    } catch (e) { }
  }

  const handleAccept = async (order) => {
    try {
      await api.put(`/work-orders/${order.id}/accept`)
      message.success('已验收通过')
      loadData()
    } catch (e) { }
  }

  const handleCancel = async (order) => {
    try {
      await api.put(`/work-orders/${order.id}/cancel`)
      message.success('工单已取消，库存已回滚')
      loadData()
    } catch (e) { }
  }

  const handleReject = async (order) => {
    try {
      await api.put(`/work-orders/${order.id}/reject`, { reason: '工单驳回' })
      message.success('工单已驳回，库存已回滚')
      loadData()
    } catch (e) { }
  }

  const columns = [
    { title: '工单号', dataIndex: 'id', width: 80, render: v => `WO-${String(v).padStart(5, '0')}` },
    { title: '标题', dataIndex: 'title', render: (_, r) => <a onClick={() => viewDetail(r)}>{r.title}</a> },
    {
      title: '设备', dataIndex: 'device_name', width: 140,
      render: (v, r) => v ? <Tag>{v} ({r.device_code})</Tag> : '-'
    },
    { title: '所属产线', dataIndex: 'line_name', width: 100, render: v => v || '-' },
    { title: '异常项', dataIndex: 'item_name', width: 120, render: v => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s) => {
        const cfg = statusConfig[s] || defaultStatusConfig
        return <Tag icon={cfg.icon} color={cfg.color}>{cfg.text}</Tag>
      }
    },
    { title: '维修人员', dataIndex: 'assignee_name', width: 100, render: v => v ? <Space><UserOutlined />{v}</Space> : '-' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'
    },
    {
      title: '操作',
      width: 260,
      render: (_, r) => (
        <Space size="small" wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => viewDetail(r)}>详情</Button>
          {r.status === 'pending' && (
            <>
              <Button size="small" type="primary" icon={<UserOutlined />} onClick={() => openAssign(r)}>指派</Button>
              <Popconfirm title="确定取消此工单？" onConfirm={() => handleCancel(r)}>
                <Button size="small" danger icon={<CloseOutlined />}>取消</Button>
              </Popconfirm>
            </>
          )}
          {r.status === 'in_progress' && (
            <>
              <Button size="small" onClick={() => handleComplete(r)}>标记完成</Button>
              <Popconfirm title="驳回工单将回滚已扣减的库存，确定？" onConfirm={() => handleReject(r)}>
                <Button size="small" danger icon={<StopOutlined />}>驳回</Button>
              </Popconfirm>
            </>
          )}
          {r.status === 'completed' && (
            <Button size="small" type="primary" onClick={() => handleAccept(r)}>验收</Button>
          )}
        </Space>
      )
    }
  ]

  const getTimeline = (order) => {
    const items = [{ color: 'blue', dot: <ClockCircleOutlined />, children: `工单创建 - ${dayjs(order.created_at).format('YYYY-MM-DD HH:mm')}` }]
    if (order.assigned_at) items.push({ color: 'geekblue', dot: <UserOutlined />, children: `已指派 ${order.assignee_name} - ${dayjs(order.assigned_at).format('YYYY-MM-DD HH:mm')}` })
    if (order.completed_at) items.push({ color: 'purple', dot: <CheckSquareOutlined />, children: `维修完成 - ${dayjs(order.completed_at).format('YYYY-MM-DD HH:mm')}` })
    if (order.accepted_at) items.push({ color: 'green', dot: <CheckCircleOutlined />, children: `已验收 - ${dayjs(order.accepted_at).format('YYYY-MM-DD HH:mm')}` })
    if (order.status === 'cancelled') items.push({ color: 'gray', dot: <CloseOutlined />, children: `已取消` })
    if (order.status === 'rejected') items.push({ color: 'red', dot: <StopOutlined />, children: `已驳回` })
    return items
  }

  const stats = {
    pending: orders.filter(o => o.status === 'pending').length,
    in_progress: orders.filter(o => o.status === 'in_progress').length,
    completed: orders.filter(o => o.status === 'completed').length,
    accepted: orders.filter(o => o.status === 'accepted').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    rejected: orders.filter(o => o.status === 'rejected').length
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>维修工单管理</h2>
        <Space>
          <Select
            placeholder="按状态筛选"
            style={{ width: 140 }}
            allowClear
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'pending', label: '待分配' },
              { value: 'in_progress', label: '维修中' },
              { value: 'completed', label: '已完成' },
              { value: 'accepted', label: '已验收' },
              { value: 'cancelled', label: '已取消' },
              { value: 'rejected', label: '已驳回' }
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card size="small">
            <Badge status="warning" text={<Text strong style={{ color: '#faad14' }}>待分配</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#faad14' }}>{stats.pending}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Badge status="processing" text={<Text strong style={{ color: '#1677ff' }}>维修中</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#1677ff' }}>{stats.in_progress}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Badge status="default" text={<Text strong style={{ color: '#722ed1' }}>待验收</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#722ed1' }}>{stats.completed}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Badge status="success" text={<Text strong style={{ color: '#52c41a' }}>已验收</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#52c41a' }}>{stats.accepted}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Badge status="default" text={<Text strong style={{ color: '#999' }}>已取消</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#999' }}>{stats.cancelled}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Badge status="error" text={<Text strong style={{ color: '#ff4d4f' }}>已驳回</Text>} />
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#ff4d4f' }}>{stats.rejected}</div>
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="工单详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>关闭</Button>}
        width={700}
        destroyOnClose
      >
        {currentOrder && (
          <div>
            <Descriptions column={2} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="工单号">WO-{String(currentOrder.id).padStart(5, '0')}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag icon={(statusConfig[currentOrder.status] || defaultStatusConfig).icon} color={(statusConfig[currentOrder.status] || defaultStatusConfig).color}>
                  {(statusConfig[currentOrder.status] || defaultStatusConfig).text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="设备" span={2}>{currentOrder.device_name || '-'} ({currentOrder.device_code || '-'}) - {currentOrder.line_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="异常项">{currentOrder.item_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="维修人员">{currentOrder.assignee_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="问题描述" span={2}>{currentOrder.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="详细说明" span={2}>{currentOrder.defect_remark || '-'}</Descriptions.Item>
            </Descriptions>

            {currentOrder.photos?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Divider orientation="left" style={{ margin: '8px 0' }}>现场照片</Divider>
                <Image.PreviewGroup>
                  <Space wrap>
                    {currentOrder.photos.map(p => (
                      <Image key={p.id} width={140} height={140} src={p.file_path} />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </div>
            )}

            <Divider orientation="left" style={{ margin: '8px 0' }}>处理进度</Divider>
            <Timeline items={getTimeline(currentOrder)} />
          </div>
        )}
      </Modal>

      <Modal
        title="指派维修人员"
        open={assignVisible}
        onOk={handleAssign}
        onCancel={() => setAssignVisible(false)}
        okText="确认指派"
        width={700}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Input
            prefix={<UserOutlined />}
            placeholder="输入维修人员姓名"
            value={assigneeName}
            onChange={e => setAssigneeName(e.target.value)}
            size="large"
          />
        </div>

        <Divider orientation="left" style={{ margin: '12px 0' }}>
          <Space>
            <WarningOutlined />
            关联备件（可选）
          </Space>
        </Divider>
        <p style={{ color: '#888', fontSize: 12, margin: '4px 0 12px' }}>
          指派时选择需要的备件，系统将校验库存并自动扣减。库存不足的工单不允许指派。
        </p>

        {selectedParts.map((sp, idx) => (
          <Row key={idx} gutter={8} style={{ marginBottom: 8 }} align="middle">
            <Col span={14}>
              <Select
                placeholder="选择备件"
                style={{ width: '100%' }}
                value={sp.spare_part_id}
                onChange={v => updateSelectedPart(idx, 'spare_part_id', v)}
                loading={sparePartsLoading}
                showSearch
                optionFilterProp="label"
                options={spareParts.map(p => ({
                  value: p.id,
                  label: `${p.name} (${p.spec_model}) [库存: ${p.current_stock}]`
                }))}
              />
            </Col>
            <Col span={6}>
              <InputNumber
                min={1}
                value={sp.quantity}
                onChange={v => updateSelectedPart(idx, 'quantity', v)}
                style={{ width: '100%' }}
                placeholder="数量"
              />
            </Col>
            <Col span={4}>
              <Button danger icon={<DeleteOutlined />} onClick={() => removeSelectedPart(idx)} />
            </Col>
          </Row>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addSelectedPart} style={{ marginTop: 4 }}>
          添加备件
        </Button>
      </Modal>
    </div>
  )
}

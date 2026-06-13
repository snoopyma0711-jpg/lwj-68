import React, { useState, useEffect } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select,
  Popconfirm, message, Card, Row, Col, Statistic, Badge, Typography,
  Divider, Alert, Empty
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  InboxOutlined, WarningOutlined, AppstoreOutlined
} from '@ant-design/icons'
import api from '../api'

const { Text } = Typography

export default function SpareParts() {
  const [parts, setParts] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [stockInVisible, setStockInVisible] = useState(false)
  const [stockInItems, setStockInItems] = useState([])
  const [warningVisible, setWarningVisible] = useState(false)
  const [warnings, setWarnings] = useState([])
  const [lineFilter, setLineFilter] = useState()
  const [form] = Form.useForm()

  const loadData = async () => {
    setLoading(true)
    try {
      const params = {}
      if (lineFilter) params.line_id = lineFilter
      const [data, lineData] = await Promise.all([
        api.get('/spare-parts', { params }),
        api.get('/lines')
      ])
      setParts(data)
      setLines(lineData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [lineFilter])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ safety_stock: 0, current_stock: 0 })
    setModalVisible(true)
  }

  const openEdit = (part) => {
    setEditing(part)
    form.setFieldsValue({
      name: part.name,
      spec_model: part.spec_model,
      line_id: part.line_id,
      safety_stock: part.safety_stock,
      current_stock: part.current_stock
    })
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editing) {
        await api.put(`/spare-parts/${editing.id}`, values)
        message.success('更新成功')
      } else {
        await api.post('/spare-parts', values)
        message.success('创建成功')
      }
      setModalVisible(false)
      loadData()
    } catch (e) { }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/spare-parts/${id}`)
      message.success('删除成功')
      loadData()
    } catch (e) { }
  }

  const openStockIn = () => {
    setStockInItems([{ spare_part_id: null, quantity: 1, remark: '' }])
    setStockInVisible(true)
  }

  const addStockInItem = () => {
    if (stockInItems.length >= 50) {
      message.warning('一次最多入库50条')
      return
    }
    setStockInItems(prev => [...prev, { spare_part_id: null, quantity: 1, remark: '' }])
  }

  const removeStockInItem = (idx) => {
    setStockInItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateStockInItem = (idx, field, value) => {
    setStockInItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const handleStockIn = async () => {
    const validItems = stockInItems.filter(i => i.spare_part_id && i.quantity > 0)
    if (validItems.length === 0) {
      message.warning('请至少填写一条有效的入库记录')
      return
    }
    try {
      const result = await api.post('/spare-parts/stock-in', { items: validItems })
      message.success(`成功入库 ${result.results.length} 条记录`)
      setStockInVisible(false)
      loadData()
    } catch (e) { }
  }

  const openWarnings = async () => {
    try {
      const data = await api.get('/spare-parts/warnings/low-stock')
      setWarnings(data)
      setWarningVisible(true)
    } catch (e) { }
  }

  const lowStockCount = parts.filter(p => p.current_stock < p.safety_stock).length
  const totalStock = parts.reduce((sum, p) => sum + p.current_stock, 0)

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '备件名称', dataIndex: 'name', width: 120, render: v => <Text strong>{v}</Text> },
    { title: '规格型号', dataIndex: 'spec_model', width: 140 },
    {
      title: '所属产线', dataIndex: 'line_name', width: 120,
      render: v => v ? <Tag color="blue">{v}</Tag> : '-'
    },
    {
      title: '当前库存', dataIndex: 'current_stock', width: 100,
      render: (v, r) => (
        <Text strong style={{ color: v < r.safety_stock ? '#ff4d4f' : '#52c41a' }}>
          {v}
        </Text>
      )
    },
    {
      title: '安全库存', dataIndex: 'safety_stock', width: 100,
      render: v => <Text type="secondary">{v}</Text>
    },
    {
      title: '库存状态', width: 100,
      render: (_, r) => {
        if (r.current_stock < r.safety_stock) {
          return <Tag color="red" icon={<WarningOutlined />}>库存不足</Tag>
        }
        return <Tag color="green">正常</Tag>
      }
    },
    {
      title: '更新时间', dataIndex: 'updated_at', width: 160,
      render: v => v || '-'
    },
    {
      title: '操作', width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除此备件？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>备件库存管理</h2>
        <Space>
          <Select
            placeholder="按产线筛选"
            style={{ width: 140 }}
            allowClear
            value={lineFilter}
            onChange={setLineFilter}
            options={lines.map(l => ({ value: l.id, label: l.name }))}
          />
          <Button
            icon={<WarningOutlined />}
            onClick={openWarnings}
            danger={lowStockCount > 0}
          >
            库存预警 {lowStockCount > 0 ? `(${lowStockCount})` : ''}
          </Button>
          <Button icon={<InboxOutlined />} onClick={openStockIn}>批量入库</Button>
          <Button icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增备件</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="备件种类" value={parts.length} prefix={<AppstoreOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="库存总量" value={totalStock} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="低库存预警"
              value={lowStockCount}
              prefix={<WarningOutlined />}
              valueStyle={{ color: lowStockCount > 0 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {lowStockCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`当前有 ${lowStockCount} 种备件库存低于安全库存量，请及时补货`}
          style={{ marginBottom: 16 }}
          action={<Button size="small" onClick={openWarnings}>查看详情</Button>}
        />
      )}

      <Table
        columns={columns}
        dataSource={parts}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? '编辑备件' : '新增备件'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="备件名称" rules={[{ required: true, message: '请输入备件名称' }]}>
            <Input placeholder="如：轴承" />
          </Form.Item>
          <Form.Item name="spec_model" label="规格型号" rules={[{ required: true, message: '请输入规格型号' }]}>
            <Input placeholder="如：SKF-6205" />
          </Form.Item>
          <Form.Item name="line_id" label="所属产线" rules={[{ required: true, message: '请选择产线' }]}>
            <Select placeholder="选择产线">
              {lines.map(l => <Select.Option key={l.id} value={l.id}>{l.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="safety_stock" label="安全库存量" rules={[{ required: true, message: '请输入安全库存量' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="current_stock" label="当前库存量" rules={[{ required: true, message: '请输入当前库存量' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="批量入库"
        open={stockInVisible}
        onCancel={() => setStockInVisible(false)}
        onOk={handleStockIn}
        okText="确认入库"
        width={700}
        destroyOnClose
      >
        <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          一次最多入库50条记录。选择备件并填写入库数量。
        </p>
        {stockInItems.map((item, idx) => (
          <Row key={idx} gutter={8} style={{ marginBottom: 8 }} align="middle">
            <Col span={10}>
              <Select
                placeholder="选择备件"
                style={{ width: '100%' }}
                value={item.spare_part_id}
                onChange={v => updateStockInItem(idx, 'spare_part_id', v)}
                showSearch
                optionFilterProp="label"
                options={parts.map(p => ({
                  value: p.id,
                  label: `${p.name} (${p.spec_model}) [当前: ${p.current_stock}]`
                }))}
              />
            </Col>
            <Col span={5}>
              <InputNumber
                min={1}
                value={item.quantity}
                onChange={v => updateStockInItem(idx, 'quantity', v)}
                style={{ width: '100%' }}
                placeholder="数量"
              />
            </Col>
            <Col span={7}>
              <Input
                placeholder="备注（可选）"
                value={item.remark}
                onChange={e => updateStockInItem(idx, 'remark', e.target.value)}
              />
            </Col>
            <Col span={2}>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeStockInItem(idx)}
                disabled={stockInItems.length <= 1}
              />
            </Col>
          </Row>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={addStockInItem} style={{ marginTop: 4 }}>
          添加一行
        </Button>
      </Modal>

      <Modal
        title={<Space><WarningOutlined style={{ color: '#ff4d4f' }} />库存预警列表</Space>}
        open={warningVisible}
        onCancel={() => setWarningVisible(false)}
        footer={<Button onClick={() => setWarningVisible(false)}>关闭</Button>}
        width={800}
      >
        {warnings.length === 0 ? (
          <Empty description="暂无低库存备件" />
        ) : (
          <Table
            size="small"
            dataSource={warnings}
            rowKey="id"
            pagination={false}
            columns={[
              { title: '备件名称', dataIndex: 'name', render: v => <Text strong>{v}</Text> },
              { title: '规格型号', dataIndex: 'spec_model' },
              { title: '所属产线', dataIndex: 'line_name', render: v => v || '-' },
              {
                title: '当前库存', dataIndex: 'current_stock',
                render: v => <Text style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{v}</Text>
              },
              { title: '安全库存', dataIndex: 'safety_stock' },
              {
                title: '缺口数量', dataIndex: 'shortage',
                render: v => <Tag color="red">缺 {v}</Tag>,
                sorter: (a, b) => a.shortage - b.shortage,
                defaultSortOrder: 'descend'
              }
            ]}
          />
        )}
      </Modal>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select, Switch,
  List, Card, Popconfirm, message, Checkbox, Row, Col, Divider, Empty
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  SettingOutlined, CheckOutlined
} from '@ant-design/icons'
import api from '../api'

const { Option } = Select

const weekdayMap = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' }
]

const defaultCheckItems = ['轴承温度', '润滑油位', '异响', '振动', '外观清洁', '仪表读数']

export default function TemplateManagement() {
  const [templates, setTemplates] = useState([])
  const [devices, setDevices] = useState([])
  const [inspectors, setInspectors] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const loadData = async () => {
    setLoading(true)
    try {
      const [tpls, devs, insps] = await Promise.all([
        api.get('/templates'),
        api.get('/devices'),
        api.get('/inspectors')
      ])
      setTemplates(tpls)
      setDevices(devs)
      setInspectors(insps)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      cycle_type: 'daily',
      is_active: true,
      devices: []
    })
    setModalVisible(true)
  }

  const openEdit = (tpl) => {
    setEditing(tpl)
    form.setFieldsValue({
      name: tpl.name,
      cycle_type: tpl.cycle_type,
      cycle_weekdays: tpl.cycle_weekdays ? JSON.parse(tpl.cycle_weekdays) : [],
      assigned_user_id: tpl.assigned_user_id,
      is_active: !!tpl.is_active,
      devices: tpl.devices.map(d => ({
        device_id: d.device_id,
        check_items: d.check_items
      }))
    })
    setModalVisible(true)
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/templates/${id}`)
      message.success('删除成功')
      loadData()
    } catch (e) { }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (!values.devices || values.devices.length === 0) {
        message.warning('请至少添加一台设备')
        return
      }
      for (const d of values.devices) {
        if (!d.check_items || d.check_items.length === 0) {
          message.warning('每台设备至少需要一个检查项')
          return
        }
      }
      const payload = {
        ...values,
        cycle_weekdays: values.cycle_type === 'weekly' ? JSON.stringify(values.cycle_weekdays || []) : null
      }
      if (editing) {
        await api.put(`/templates/${editing.id}`, payload)
        message.success('更新成功')
      } else {
        await api.post('/templates', payload)
        message.success('创建成功')
      }
      setModalVisible(false)
      loadData()
    } catch (e) { }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模板名称', dataIndex: 'name' },
    {
      title: '循环类型',
      dataIndex: 'cycle_type',
      width: 100,
      render: (v) => <Tag color={v === 'daily' ? 'blue' : 'purple'}>{v === 'daily' ? '按日' : '按周'}</Tag>
    },
    {
      title: '周期详情',
      width: 200,
      render: (_, r) => r.cycle_type === 'weekly' && r.cycle_weekdays
        ? JSON.parse(r.cycle_weekdays).map(w => weekdayMap.find(x => x.value === w)?.label).join('、')
        : '每日执行'
    },
    {
      title: '设备数',
      width: 80,
      render: (_, r) => `${r.devices?.length || 0}台`
    },
    { title: '指派巡检员', dataIndex: 'assigned_user_name', width: 120, render: (v) => v || '-' },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => v ? <Tag color="green">启用</Tag> : <Tag color="gray">停用</Tag>
    },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除此模板？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>巡检模板管理</h2>
        <Space>
          <Button
            icon={<SettingOutlined />}
            onClick={async () => {
              await api.post('/tasks/generate-today')
              message.success('已触发生成今日巡检任务')
            }}
          >
            生成今日任务
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={templates}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        expandedRowRender={(tpl) => (
          <List
            dataSource={tpl.devices}
            renderItem={(dev) => (
              <List.Item>
                <Space style={{ width: '100%' }} direction="vertical">
                  <Space>
                    <Tag color="blue">{dev.order_index + 1}</Tag>
                    <strong>{dev.device_name}</strong>
                    <span style={{ color: '#888' }}>({dev.device_code})</span>
                  </Space>
                  <div>
                    检查项目：
                    {dev.check_items?.map((item, idx) => (
                      <Tag key={idx} color="geekblue">{item.item_name}</Tag>
                    ))}
                  </div>
                </Space>
              </List.Item>
            )}
          />
        )}
      />

      <Modal
        title={editing ? '编辑巡检模板' : '新建巡检模板'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        width={900}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
                <Input placeholder="如：A产线日常巡检" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="cycle_type" label="循环类型" rules={[{ required: true }]}>
                <Select>
                  <Option value="daily">按日</Option>
                  <Option value="weekly">按周</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="is_active" label="启用" valuePropName="checked">
                <Switch checkedChildren={<CheckOutlined />} unCheckedChildren="关" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item noStyle shouldUpdate={(p, n) => p.cycle_type !== n.cycle_type}>
                {({ getFieldValue }) => getFieldValue('cycle_type') === 'weekly' ? (
                  <Form.Item name="cycle_weekdays" label="执行日" rules={[{ required: true, message: '请选择执行日' }]}>
                    <Checkbox.Group options={weekdayMap} />
                  </Form.Item>
                ) : null}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assigned_user_id" label="指派巡检员" rules={[{ required: true, message: '请选择巡检员' }]}>
                <Select placeholder="选择巡检员">
                  {inspectors.map(u => <Option key={u.id} value={u.id}>{u.name} ({u.username})</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '8px 0' }}>巡检路线（设备顺序）</Divider>

          <Form.List name="devices">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={`设备 ${name + 1}`}
                    extra={fields.length > 1 ? <Button size="small" danger onClick={() => remove(name)}>删除</Button> : null}
                  >
                    <Form.Item
                      {...restField}
                      name={[name, 'device_id']}
                      rules={[{ required: true, message: '请选择设备' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Select placeholder="选择设备" showSearch optionFilterProp="children">
                        {devices.map(d => <Option key={d.id} value={d.id}>{d.name} ({d.code}) - {d.line_name}</Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item label="检查项目" style={{ marginBottom: 0 }}>
                      <Form.List name={[name, 'check_items']}>
                        {(itemFields, itemOps) => (
                          <div>
                            {itemFields.map((itemField) => (
                              <Space key={itemField.key} style={{ marginBottom: 4, display: 'flex' }}>
                                <Form.Item
                                  {...itemField.restField}
                                  name={[itemField.name, 'item_name']}
                                  rules={[{ required: true, message: '请输入检查项名称' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="如：轴承温度" style={{ width: 260 }} />
                                </Form.Item>
                                <Form.Item
                                  {...itemField.restField}
                                  name={[itemField.name, 'description']}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder="描述（可选）" style={{ width: 200 }} />
                                </Form.Item>
                                <Button size="small" danger onClick={() => itemOps.remove(itemField.name)}>删除</Button>
                              </Space>
                            ))}
                            <Space style={{ marginTop: 4 }}>
                              <Button size="small" icon={<PlusOutlined />} onClick={() => itemOps.add({ item_name: '', description: '' })}>添加检查项</Button>
                              <Select
                                size="small"
                                placeholder="快速添加常用项"
                                style={{ width: 160 }}
                                onChange={(val) => {
                                  if (val) itemOps.add({ item_name: val, description: '' })
                                }}
                                allowClear
                              >
                                {defaultCheckItems.map(c => <Option key={c} value={c}>{c}</Option>)}
                              </Select>
                            </Space>
                            {itemFields.length === 0 && <Empty description="请添加检查项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                          </div>
                        )}
                      </Form.List>
                    </Form.Item>
                  </Card>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ device_id: null, check_items: [] })}>
                  添加设备
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Steps, Button, Form, Radio, Input, Upload, Space, Tag,
  message, Descriptions, Alert, Image, Row, Col, Divider, Typography
} from 'antd'
import {
  ArrowLeftOutlined, CheckCircleOutlined, UploadOutlined,
  ExclamationCircleOutlined, WarningOutlined
} from '@ant-design/icons'
import api from '../api'
import dayjs from 'dayjs'

const { TextArea } = Input
const { Title, Text } = Typography

export default function TaskExecute({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const loadTask = async () => {
    setLoading(true)
    try {
      const data = await api.get(`/tasks/${id}`)
      setTask(data)
      const firstPending = data.devices.findIndex(d => d.status === 'pending')
      setCurrentStep(firstPending >= 0 ? firstPending : 0)
      const initialData = {}
      data.devices.forEach((dev, idx) => {
        initialData[idx] = {}
        dev.check_items.forEach(item => {
          const existing = dev.results.find(r => r.item_name === item.item_name)
          if (existing) {
            initialData[idx][item.item_name] = {
              result: existing.result,
              remark: existing.remark || '',
              photos: existing.photos || [],
              existingPhotos: existing.photos || []
            }
          } else {
            initialData[idx][item.item_name] = { result: '', remark: '', photos: [], existingPhotos: [] }
          }
        })
      })
      setFormData(initialData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTask()
  }, [id])

  if (loading || !task) return null

  const currentDevice = task.devices[currentStep]
  const canEdit = user?.role === 'inspector' && task.assigned_user_id === user.id

  const updateItem = (deviceIdx, itemName, field, value) => {
    setFormData(prev => {
      const next = { ...prev }
      next[deviceIdx] = { ...next[deviceIdx] }
      next[deviceIdx][itemName] = { ...next[deviceIdx][itemName], [field]: value }
      return next
    })
  }

  const handleSubmit = async () => {
    const deviceData = formData[currentStep]
    const checkResults = []
    const photoFiles = []
    let photoCount = 0

    for (const item of currentDevice.check_items) {
      const itemData = deviceData[item.item_name]
      if (!itemData || !itemData.result) {
        message.warning(`请选择"${item.item_name}"的检查结果`)
        return
      }
      if (itemData.result === 'abnormal' && (!itemData.remark || !itemData.remark.trim())) {
        message.warning(`异常项"${item.item_name}"必须填写文字说明`)
        return
      }
      if (itemData.result === 'abnormal' && itemData.photos?.length === 0 && itemData.existingPhotos?.length === 0) {
        message.warning(`异常项"${item.item_name}"必须至少上传一张照片`)
        return
      }
      if (itemData.photos?.length > 3) {
        message.warning(`异常项"${item.item_name}"最多上传3张照片`)
        return
      }

      checkResults.push({
        item_name: item.item_name,
        result: itemData.result,
        remark: itemData.remark || '',
        photo_count: itemData.photos?.length || 0
      })

      if (itemData.photos?.length > 0) {
        itemData.photos.forEach(p => {
          photoFiles.push(p)
          photoCount++
        })
      }
    }

    const formDataObj = new FormData()
    formDataObj.append('check_results', JSON.stringify(checkResults))
    photoFiles.forEach(f => {
      if (f.originFileObj) formDataObj.append('photos', f.originFileObj)
    })

    setSubmitting(true)
    try {
      const res = await api.post(
        `/tasks/${task.id}/devices/${currentDevice.device_id}/submit`,
        formDataObj,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      if (res.idempotent) {
        message.info('该设备已提交过（幂等处理）')
      } else {
        message.success('提交成功')
      }
      await loadTask()
    } catch (e) {
    } finally {
      setSubmitting(false)
    }
  }

  const isPreviousPending = (idx) => {
    for (let i = 0; i < idx; i++) {
      if (task.devices[i].status === 'pending') return true
    }
    return false
  }

  const stepStatus = (idx) => {
    const dev = task.devices[idx]
    if (dev.status === 'completed') return 'finish'
    if (isPreviousPending(idx)) return 'wait'
    if (idx === currentStep) return 'process'
    return 'wait'
  }

  const uploadProps = (deviceIdx, itemName) => ({
    multiple: true,
    accept: 'image/*',
    fileList: formData[deviceIdx]?.[itemName]?.photos || [],
    beforeUpload: () => false,
    onChange: ({ fileList }) => {
      if (fileList.length > 3) {
        message.warning('每个异常项最多只能上传3张照片')
        fileList = fileList.slice(0, 3)
      }
      updateItem(deviceIdx, itemName, 'photos', fileList)
    }
  })

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        <Title level={3} style={{ margin: 0 }}>{task.template_name}</Title>
        <Tag color={task.status === 'completed' ? 'green' : task.status === 'in_progress' ? 'blue' : 'orange'}>
          {task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : '待执行'}
        </Tag>
      </Space>

      <Descriptions column={3} size="small" style={{ marginBottom: 16 }} bordered>
        <Descriptions.Item label="任务日期">{dayjs(task.task_date).format('YYYY-MM-DD')}</Descriptions.Item>
        <Descriptions.Item label="巡检员">{task.assigned_user_name}</Descriptions.Item>
        <Descriptions.Item label="设备总数">{task.devices.length}台</Descriptions.Item>
      </Descriptions>

      <Steps
        size="small"
        current={currentStep}
        onChange={(idx) => {
          if (canEdit && isPreviousPending(idx)) {
            message.warning('请按路线顺序逐台检查')
            return
          }
          setCurrentStep(idx)
        }}
        items={task.devices.map((dev, idx) => ({
          title: dev.device_name,
          description: dev.device_code,
          status: stepStatus(idx)
        }))}
        style={{ marginBottom: 24 }}
      />

      {currentDevice && (
        <Card
          title={
            <Space>
              <CheckCircleOutlined style={{ color: currentDevice.status === 'completed' ? '#52c41a' : '#faad14' }} />
              {currentDevice.device_name}
              <Text type="secondary">({currentDevice.device_code})</Text>
            </Space>
          }
          extra={<Space>
            <Tag>{currentDevice.line_name}</Tag>
            <Tag>{currentDevice.location || '未设置位置'}</Tag>
            {currentDevice.status === 'completed' && <Tag color="green">已完成</Tag>}
          </Space>}
        >
          {canEdit && currentDevice.status === 'pending' && isPreviousPending(currentStep) && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="请按路线顺序完成前面设备的检查后，再提交当前设备"
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider orientation="left" style={{ marginTop: 0 }}>检查项目</Divider>

          <Form layout="vertical">
            {currentDevice.check_items.map((item, idx) => {
              const itemData = formData[currentStep]?.[item.item_name] || {}
              const isAbnormal = itemData.result === 'abnormal'
              const isDone = currentDevice.status === 'completed'
              const existingPhotos = itemData.existingPhotos || []

              return (
                <Card
                  key={item.id}
                  size="small"
                  style={{ marginBottom: 12, borderLeft: isAbnormal ? '4px solid #ff4d4f' : undefined }}
                  title={<Space>
                    {isAbnormal && <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
                    <Text strong>{idx + 1}. {item.item_name}</Text>
                    {item.description && <Text type="secondary" style={{ fontSize: 12 }}>{item.description}</Text>}
                  </Space>}
                >
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item label="检查结果" required style={{ marginBottom: 0 }}>
                        <Radio.Group
                          value={itemData.result}
                          onChange={e => updateItem(currentStep, item.item_name, 'result', e.target.value)}
                          disabled={isDone || !canEdit}
                        >
                          <Radio value="normal">正常</Radio>
                          <Radio value="abnormal">异常</Radio>
                          <Radio value="skipped">跳过</Radio>
                        </Radio.Group>
                      </Form.Item>
                    </Col>
                    {isAbnormal && (
                      <Col span={16}>
                        <Form.Item
                          label="异常说明"
                          required
                          style={{ marginBottom: 0 }}
                        >
                          <TextArea
                            rows={2}
                            placeholder="请详细描述异常情况"
                            value={itemData.remark || ''}
                            onChange={e => updateItem(currentStep, item.item_name, 'remark', e.target.value)}
                            disabled={isDone || !canEdit}
                          />
                        </Form.Item>
                      </Col>
                    )}
                  </Row>

                  {isAbnormal && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        现场照片（最多3张，单张不超过5MB）{isDone ? '' : '（必须上传至少1张）'}：
                      </Text>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        {existingPhotos.length > 0 && existingPhotos.map(p => (
                          <Image key={p.id} width={100} height={100} src={p.file_path} />
                        ))}
                        {!isDone && canEdit && (
                          <Upload {...uploadProps(currentStep, item.item_name)}>
                            <Button icon={<UploadOutlined />}>选择照片</Button>
                          </Upload>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </Form>

          {canEdit && currentDevice.status === 'pending' && (
            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <Button
                type="primary"
                size="large"
                loading={submitting}
                onClick={handleSubmit}
                disabled={isPreviousPending(currentStep)}
              >
                提交此设备检查结果
              </Button>
            </div>
          )}

          {currentDevice.status === 'completed' && currentDevice.submitted_at && (
            <Alert
              type="success"
              showIcon
              message={`该设备已于 ${dayjs(currentDevice.submitted_at).format('YYYY-MM-DD HH:mm:ss')} 提交完成`}
              style={{ marginTop: 16 }}
            />
          )}
        </Card>
      )}
    </div>
  )
}

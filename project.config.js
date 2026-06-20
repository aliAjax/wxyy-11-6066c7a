module.exports = {
  port: 3911,
  title: '寺庙经卷修补借阅流转',
  lede: '为经卷建立保护档案，记录修补工序、借阅审批、归还追踪和完整生命周期。',
  tones: {
    '可借阅': 'ok',
    '已完成': 'ok',
    '已归还': 'ok',
    '需审批': 'warn',
    '待审批': 'warn',
    '已批准': 'warn',
    '已借出': 'warn',
    '计划中': 'warn',
    '进行中': 'warn',
    '限制借阅': 'bad',
    '修补中': 'bad',
    '已拒绝': 'bad',
    '模糊': 'bad',
    '待重拍': 'bad',
    '清晰': 'ok',
    '已归档': 'ok'
  },
  collections: {
    scrolls: { label: '经卷档案' },
    repairs: { label: '修补记录' },
    loans: { label: '借阅申请' },
    imagings: { label: '影像采集档案' }
  },
  stats: [
    { label: '经卷档案', collection: 'scrolls' },
    { label: '一级保护', collection: 'scrolls', filter: { field: 'protectionLevel', value: '一级' } },
    { label: '修补记录', collection: 'repairs' },
    { label: '借阅中', collection: 'loans', filter: { field: 'status', value: '已借出' } },
    { label: '影像采集', collection: 'imagings' }
  ],
  views: [
    {
      id: 'dashboard',
      label: '生命周期',
      type: 'dashboard',
      focusTitle: '重点保护经卷',
      focus: { collection: 'scrolls', field: 'borrowStatus', values: ['限制借阅', '修补中', '需审批'], limit: 8 }
    },
    {
      id: 'scrolls',
      label: '经卷档案',
      collection: 'scrolls',
      formTitle: '新增经卷档案',
      listTitle: '经卷列表',
      submitLabel: '保存档案',
      searchPlaceholder: '搜索卷名、年代、柜位',
      searchFields: ['title', 'era', 'cabinet', 'material'],
      statusField: 'borrowStatus',
      statusOptions: ['可借阅', '需审批', '限制借阅', '修补中'],
      titleFields: ['title'],
      summaryFields: ['damage', 'inscription'],
      detailFields: [
        { label: '材质', name: 'material' },
        { label: '年代', name: 'era' },
        { label: '保护等级', name: 'protectionLevel' }
      ],
      fields: [
        { label: '卷名', name: 'title', required: true },
        { label: '材质', name: 'material', required: true },
        { label: '年代判断', name: 'era', required: true },
        { label: '存放柜位', name: 'cabinet', required: true },
        { label: '保护等级', name: 'protectionLevel', type: 'select', options: ['一级', '二级', '三级'] },
        { label: '借阅状态', name: 'borrowStatus', type: 'select', options: ['可借阅', '需审批', '限制借阅', '修补中'] },
        { label: '残损位置', name: 'damage', type: 'textarea', required: true, wide: true },
        { label: '题跋信息', name: 'inscription', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'repairs',
      label: '修补记录',
      collection: 'repairs',
      formTitle: '登记修补工序',
      listTitle: '修补记录',
      submitLabel: '保存修补记录',
      searchPlaceholder: '搜索工序、人员、记录',
      searchFields: ['process', 'conservator', 'note', 'materialUsed'],
      statusField: 'status',
      statusOptions: ['计划中', '进行中', '已完成'],
      titleFields: ['process', 'conservator'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'protectionLevel'] },
      summaryFields: ['materialUsed', 'note'],
      detailFields: [
        { label: '日期', name: 'date' },
        { label: '状态', name: 'status' },
        { label: '工序', name: 'process' }
      ],
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'protectionLevel'], required: true, wide: true },
        { label: '工序', name: 'process', type: 'select', options: ['除尘', '展平', '托裱', '补纸', '装函', '影像采集'] },
        { label: '修补人员', name: 'conservator', required: true },
        { label: '日期', name: 'date', type: 'date', required: true },
        { label: '状态', name: 'status', type: 'select', options: ['计划中', '进行中', '已完成'] },
        { label: '材料', name: 'materialUsed', type: 'textarea', wide: true },
        { label: '记录', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'loans',
      label: '借阅审批',
      collection: 'loans',
      formTitle: '提交借阅',
      listTitle: '借阅流转',
      submitLabel: '提交借阅审批',
      searchPlaceholder: '搜索借阅人、用途',
      searchFields: ['borrower', 'purpose', 'reason'],
      statusField: 'status',
      statusOptions: ['待审批', '已批准', '已借出', '已归还', '已拒绝'],
      titleFields: ['borrower', 'purpose'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'borrowStatus'] },
      summaryFields: ['reason'],
      detailFields: [
        { label: '借出日期', name: 'borrowDate' },
        { label: '预计归还', name: 'dueDate' },
        { label: '状态', name: 'status' }
      ],
      defaults: { status: '待审批' },
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'borrowStatus'], required: true, wide: true },
        { label: '借阅人', name: 'borrower', required: true },
        { label: '用途', name: 'purpose', required: true },
        { label: '借出日期', name: 'borrowDate', type: 'date', required: true },
        { label: '预计归还', name: 'dueDate', type: 'date', required: true },
        { label: '限制原因或说明', name: 'reason', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'imagings',
      label: '影像采集',
      collection: 'imagings',
      formTitle: '登记影像采集',
      listTitle: '采集记录',
      submitLabel: '保存采集记录',
      searchPlaceholder: '搜索批次、人员、影像编号',
      searchFields: ['batch', 'photographer', 'imageCode', 'note'],
      statusField: 'clarity',
      statusOptions: ['清晰', '模糊', '待重拍'],
      titleFields: ['batch', 'photographer'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'protectionLevel'] },
      summaryFields: ['imageCode', 'note'],
      detailFields: [
        { label: '采集日期', name: 'captureDate' },
        { label: '清晰度', name: 'clarity' },
        { label: '影像编号', name: 'imageCode' }
      ],
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'protectionLevel'], required: true, wide: true },
        { label: '拍摄批次', name: 'batch', required: true },
        { label: '拍摄人员', name: 'photographer', required: true },
        { label: '采集日期', name: 'captureDate', type: 'date', required: true },
        { label: '影像编号', name: 'imageCode', required: true },
        { label: '清晰度状态', name: 'clarity', type: 'select', options: ['清晰', '模糊', '待重拍'] },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'scroll-open', label: '可借阅', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '可借阅' }] },
    { id: 'scroll-approval', label: '需审批', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '需审批' }] },
    { id: 'scroll-repairing', label: '修补中', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '修补中' }] },
    { id: 'scroll-restrict', label: '限制借阅', collection: 'scrolls', danger: true, patches: [{ field: 'borrowStatus', value: '限制借阅' }] },
    { id: 'repair-doing', label: '进行中', collection: 'repairs', patches: [{ field: 'status', value: '进行中' }] },
    {
      id: 'repair-done',
      label: '完成修补',
      collection: 'repairs',
      relation: { collection: 'scrolls', localKey: 'scrollId' },
      patches: [
        { field: 'status', value: '已完成' },
        { target: 'related', field: 'borrowStatus', value: '需审批' }
      ]
    },
    { id: 'loan-approve', label: '批准', collection: 'loans', patches: [{ field: 'status', value: '已批准' }] },
    {
      id: 'loan-out',
      label: '借出',
      collection: 'loans',
      relation: { collection: 'scrolls', localKey: 'scrollId' },
      guards: [
        { left: 'related.borrowStatus', op: 'notIn', values: ['限制借阅', '修补中'], message: '经卷当前不可借出' }
      ],
      patches: [
        { field: 'status', value: '已借出' },
        { target: 'related', field: 'borrowStatus', value: '限制借阅' }
      ]
    },
    {
      id: 'loan-return',
      label: '归还',
      collection: 'loans',
      relation: { collection: 'scrolls', localKey: 'scrollId' },
      patches: [
        { field: 'status', value: '已归还' },
        { target: 'related', field: 'borrowStatus', value: '需审批' }
      ]
    },
    { id: 'loan-reject', label: '拒绝', collection: 'loans', danger: true, patches: [{ field: 'status', value: '已拒绝' }] },
    { id: 'imaging-clear', label: '清晰', collection: 'imagings', patches: [{ field: 'clarity', value: '清晰' }] },
    { id: 'imaging-blur', label: '模糊', collection: 'imagings', patches: [{ field: 'clarity', value: '模糊' }] },
    { id: 'imaging-reshoot', label: '待重拍', collection: 'imagings', danger: true, patches: [{ field: 'clarity', value: '待重拍' }] }
  ]
};

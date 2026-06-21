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
    '条件批准': 'warn',
    '已借出': 'warn',
    '计划中': 'warn',
    '进行中': 'warn',
    '限制借阅': 'bad',
    '修补中': 'bad',
    '已拒绝': 'bad',
    '模糊': 'bad',
    '待重拍': 'bad',
    '清晰': 'ok',
    '已归档': 'ok',
    '正常': 'ok',
    '待复核': 'warn',
    '已处理': 'ok',
    '异常': 'bad',
    '低余量': 'warn',
    '即将到期': 'warn',
    '不可借阅': 'extreme',
    '已过期': 'bad',
    '低风险': 'ok',
    '中风险': 'warn',
    '高风险': 'bad',
    '极高风险': 'extreme',
    '启用': 'ok',
    '停用': 'bad',
    '待确认': 'warn',
    '已确认': 'ok'
  },
  collections: {
    scrolls: { label: '经卷档案' },
    repairs: { label: '修补记录' },
    loans: { label: '借阅申请' },
    imagings: { label: '影像采集档案' },
    inventories: { label: '柜位盘点' },
    materials: { label: '修补材料台账' },
    observations: { label: '人工观察记录' },
    repairTemplates: { label: '修补方案模板' },
    repairBatches: { label: '修补任务批次' },
    drafts: { label: '导入草稿' }
  },
  materialWarning: {
    lowStockThresholds: { '张': 20, '瓶': 3, '套': 3, '把': 2, '袋': 5, '米': 10, '卷': 5, '盒': 2, '个': 5 },
    expiryWarningDays: 30
  },
  stats: [
    { label: '经卷档案', collection: 'scrolls' },
    { label: '一级保护', collection: 'scrolls', filter: { field: 'protectionLevel', value: '一级' } },
    { label: '修补记录', collection: 'repairs' },
    { label: '借阅中', collection: 'loans', filter: { field: 'status', value: '已借出' } },
    { label: '影像采集', collection: 'imagings' },
    { label: '盘点记录', collection: 'inventories' },
    { label: '待复核', collection: 'inventories', filter: { field: 'status', value: '待复核' } },
    { label: '材料品类', collection: 'materials' },
    { label: '材料预警', collection: 'materials', filter: { field: 'status', anyOf: ['低余量', '即将到期', '已过期'] } },
    { label: '方案模板', collection: 'repairTemplates' },
    { label: '进行中批次', collection: 'repairBatches', filter: { field: 'status', value: '进行中' } },
    { label: '待确认草稿', collection: 'drafts', filter: { field: 'status', value: '待确认' } }
  ],
  views: [
    {
      id: 'dashboard',
      label: '生命周期',
      type: 'dashboard',
      foci: [
        {
          title: '重点保护经卷',
          focus: { collection: 'scrolls', field: 'borrowStatus', values: ['不可借阅', '限制借阅', '修补中', '需审批'], limit: 8 }
        },
        {
          title: '待复核盘点',
          focus: { collection: 'inventories', field: 'status', values: ['待复核'], limit: 8 }
        },
        {
          title: '材料预警（低余量/即将到期/已过期）',
          focus: { collection: 'materials', field: 'status', values: ['低余量', '即将到期', '已过期'], limit: 8 },
          emptyText: '暂无预警材料'
        }
      ]
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
      statusOptions: ['可借阅', '需审批', '限制借阅', '修补中', '不可借阅'],
      titleFields: ['title'],
      summaryFields: ['damage', 'inscription'],
      detailFields: [
        { label: '材质', name: 'material' },
        { label: '年代', name: 'era' },
        { label: '保护等级', name: 'protectionLevel' }
      ],
      adviceField: {
        label: '保护建议',
        name: 'protectionAdvice'
      },
      fields: [
        { label: '卷名', name: 'title', required: true },
        { label: '材质', name: 'material', required: true },
        { label: '年代判断', name: 'era', required: true },
        { label: '存放柜位', name: 'cabinet', required: true },
        { label: '保护等级', name: 'protectionLevel', type: 'select', options: ['一级', '二级', '三级'] },
        { label: '借阅状态', name: 'borrowStatus', type: 'select', options: ['可借阅', '需审批', '限制借阅', '修补中', '不可借阅'] },
        { label: '不可借阅原因', name: 'blockReason', type: 'textarea', wide: true, showWhen: { field: 'borrowStatus', value: '不可借阅' } },
        { label: '残损位置', name: 'damage', type: 'textarea', required: true, wide: true },
        { label: '题跋信息', name: 'inscription', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'repairTemplates',
      label: '修补方案模板',
      collection: 'repairTemplates',
      formTitle: '新增修补方案模板',
      listTitle: '方案模板',
      submitLabel: '保存模板',
      searchPlaceholder: '搜索模板名称、工序',
      searchFields: ['name', 'processes', 'description'],
      statusField: 'status',
      statusOptions: ['启用', '停用'],
      titleFields: ['name'],
      summaryFields: ['processes', 'description'],
      detailFields: [
        { label: '工序组合', name: 'processes' },
        { label: '状态', name: 'status' }
      ],
      defaults: { status: '启用' },
      fields: [
        { label: '模板名称', name: 'name', required: true },
        { label: '工序组合（每行一个工序）', name: 'processes', type: 'textarea', required: true, wide: true },
        { label: '说明', name: 'description', type: 'textarea', wide: true },
        { label: '状态', name: 'status', type: 'select', options: ['启用', '停用'] }
      ]
    },
    {
      id: 'repairBatches',
      label: '修补任务批次',
      collection: 'repairBatches',
      formTitle: '从模板生成修补方案',
      listTitle: '修补批次',
      submitLabel: '生成修补方案',
      searchPlaceholder: '搜索经卷、模板、负责人',
      searchFields: ['templateName', 'conservator', 'note'],
      statusField: 'status',
      statusOptions: ['进行中', '已完成'],
      titleFields: ['templateName', 'conservator'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'protectionLevel'] },
      summaryFields: ['progressSummary', 'note'],
      detailFields: [
        { label: '开始日期', name: 'startDate' },
        { label: '状态', name: 'status' },
        { label: '进度', name: 'progressSummary' }
      ],
      defaults: { status: '进行中' },
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'borrowStatus'], required: true, wide: true },
        { label: '修补方案模板', name: 'templateId', type: 'relation', collection: 'repairTemplates', labelFields: ['name', 'status'], required: true, wide: true },
        { label: '负责人', name: 'conservator', required: true },
        { label: '开始日期', name: 'startDate', type: 'date', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
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
        { label: '工序', name: 'process' },
        { label: '所属批次', name: 'batchId', type: 'relation', collection: 'repairBatches', labelFields: ['templateName', 'status'] },
        { label: '参考材料', name: 'materialId', type: 'relation', collection: 'materials', labelFields: ['name', 'batch'] },
        { label: '附件编号', name: 'attachmentCode' },
        { label: '存档链接', name: 'externalLink' }
      ],
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'protectionLevel'], required: true, wide: true },
        { label: '工序', name: 'process', type: 'select', options: ['除尘', '展平', '托裱', '补纸', '装函', '影像采集'] },
        { label: '修补人员', name: 'conservator', required: true },
        { label: '日期', name: 'date', type: 'date', required: true },
        { label: '状态', name: 'status', type: 'select', options: ['计划中', '进行中', '已完成'] },
        { label: '参考材料（台账）', name: 'materialId', type: 'relation', collection: 'materials', labelFields: ['name', 'batch', 'quantity'] },
        { label: '材料说明', name: 'materialUsed', type: 'textarea', wide: true },
        { label: '记录', name: 'note', type: 'textarea', wide: true },
        { label: '证据附件编号', name: 'attachmentCode', placeholder: '如：ATT-2026-001' },
        { label: '外部存档链接', name: 'externalLink', placeholder: '档案系统URL，可选' }
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
      statusOptions: ['待审批', '条件批准', '已批准', '已借出', '已归还', '已拒绝'],
      titleFields: ['borrower', 'purpose'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'borrowStatus'] },
      summaryFields: ['reason'],
      detailFields: [
        { label: '借出日期', name: 'borrowDate' },
        { label: '预计归还', name: 'dueDate' },
        { label: '状态', name: 'status' },
        { label: '风险等级', name: 'riskLevel' },
        { label: '保护等级', name: 'scrollProtection' },
        { label: '借阅状态', name: 'scrollBorrowStatus' },
        { label: '批准条件', name: 'conditionsSummary' }
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
      id: 'loan-calendar',
      label: '借阅预约日历',
      type: 'calendar',
      collection: 'loans',
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title'] },
      statusField: 'status',
      activeStatuses: ['待审批', '条件批准', '已批准', '已借出'],
      titleFields: ['borrower', 'purpose']
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
        { label: '影像编号', name: 'imageCode' },
        { label: '附件编号', name: 'attachmentCode' },
        { label: '存档链接', name: 'externalLink' }
      ],
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'protectionLevel'], required: true, wide: true },
        { label: '拍摄批次', name: 'batch', required: true },
        { label: '拍摄人员', name: 'photographer', required: true },
        { label: '采集日期', name: 'captureDate', type: 'date', required: true },
        { label: '影像编号', name: 'imageCode', required: true },
        { label: '清晰度状态', name: 'clarity', type: 'select', options: ['清晰', '模糊', '待重拍'] },
        { label: '备注', name: 'note', type: 'textarea', wide: true },
        { label: '证据附件编号', name: 'attachmentCode', placeholder: '如：ATT-2026-001' },
        { label: '外部存档链接', name: 'externalLink', placeholder: '档案系统URL，可选' }
      ]
    },
    {
      id: 'inventories',
      label: '柜位盘点',
      collection: 'inventories',
      formTitle: '新建柜位盘点',
      listTitle: '盘点记录',
      submitLabel: '保存盘点',
      searchPlaceholder: '搜索柜位、盘点人',
      searchFields: ['cabinet', 'inventoryPerson', 'exceptionNote'],
      statusField: 'status',
      statusOptions: ['正常', '待复核', '已处理'],
      titleFields: ['cabinet', 'inventoryPerson'],
      relation: { collection: 'scrolls', localKey: 'scrollId', labelFields: ['title', 'protectionLevel'] },
      summaryFields: ['exceptionNote'],
      detailFields: [
        { label: '盘点日期', name: 'inventoryDate' },
        { label: '盘点结果', name: 'result' },
        { label: '处理状态', name: 'status' },
        { label: '附件编号', name: 'attachmentCode' },
        { label: '存档链接', name: 'externalLink' }
      ],
      defaults: { result: '正常', status: '正常' },
      fields: [
        { label: '经卷', name: 'scrollId', type: 'relation', collection: 'scrolls', labelFields: ['title', 'cabinet'], required: true, wide: true },
        { label: '盘点人', name: 'inventoryPerson', required: true },
        { label: '盘点日期', name: 'inventoryDate', type: 'date', required: true },
        { label: '存放柜位', name: 'cabinet', required: true },
        { label: '盘点结果', name: 'result', type: 'select', options: ['正常', '异常'], required: true },
        { label: '处理状态', name: 'status', type: 'select', options: ['正常', '待复核', '已处理'], required: true },
        { label: '异常说明', name: 'exceptionNote', type: 'textarea', wide: true },
        { label: '证据附件编号', name: 'attachmentCode', placeholder: '如：ATT-2026-001' },
        { label: '外部存档链接', name: 'externalLink', placeholder: '档案系统URL，可选' }
      ]
    },
    {
      id: 'batch-import',
      label: '批量导入预检',
      type: 'batchImport',
      targetCollection: 'scrolls'
    },
    {
      id: 'drafts',
      label: '导入草稿',
      type: 'draftList',
      collection: 'drafts'
    },
    {
      id: 'consistency-check',
      label: '状态一致性巡检',
      type: 'consistencyCheck'
    },
    {
      id: 'audits',
      label: '操作审计',
      type: 'audit',
      collection: 'audits'
    },
    {
      id: 'materials',
      label: '修补材料台账',
      collection: 'materials',
      formTitle: '新增修补材料',
      listTitle: '材料台账',
      submitLabel: '登记材料',
      searchPlaceholder: '搜索材料名、批次、柜位',
      searchFields: ['name', 'batch', 'location', 'category', 'note'],
      statusField: 'status',
      statusOptions: ['正常', '低余量', '即将到期', '已过期'],
      titleFields: ['name', 'batch'],
      summaryFields: ['note'],
      detailFields: [
        { label: '分类', name: 'category' },
        { label: '余量', name: 'quantityWithUnit' },
        { label: '保管位置', name: 'location' },
        { label: '到期日期', name: 'expiryDate' },
        { label: '状态', name: 'status' }
      ],
      defaults: { unit: '张' },
      fields: [
        { label: '材料名称', name: 'name', required: true },
        { label: '分类', name: 'category', type: 'select', options: ['纸张', '浆糊', '装函材料', '软刷', '其他'], required: true },
        { label: '批次号', name: 'batch', required: true },
        { label: '余量', name: 'quantity', type: 'number', required: true },
        { label: '单位', name: 'unit', type: 'select', options: ['张', '瓶', '套', '把', '袋', '米', '卷', '盒', '个'], required: true },
        { label: '保管位置', name: 'location', required: true },
        { label: '到期日期', name: 'expiryDate', type: 'date' },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'scroll-open', label: '可借阅', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '可借阅' }] },
    { id: 'scroll-approval', label: '需审批', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '需审批' }] },
    { id: 'scroll-repairing', label: '修补中', collection: 'scrolls', patches: [{ field: 'borrowStatus', value: '修补中' }] },
    { id: 'scroll-restrict', label: '限制借阅', collection: 'scrolls', danger: true, patches: [{ field: 'borrowStatus', value: '限制借阅' }] },
    { id: 'scroll-unborrowable', label: '不可借阅', collection: 'scrolls', danger: true, guards: [{ left: 'item.blockReason', op: 'missing', message: '设为不可借阅时必须填写原因' }], patches: [{ field: 'borrowStatus', value: '不可借阅' }] },
    { id: 'repair-doing', label: '进行中', collection: 'repairs', patches: [{ field: 'status', value: '进行中' }] },
    {
      id: 'repair-done',
      label: '完成修补',
      collection: 'repairs',
      patches: [
        { field: 'status', value: '已完成' }
      ]
    },
    { id: 'loan-approve', label: '快速批准', collection: 'loans', relation: { collection: 'scrolls', localKey: 'scrollId' }, guards: [{ left: 'related.borrowStatus', op: 'notIn', values: ['不可借阅', '修补中'], message: '经卷当前状态为「不可借阅」或「修补中」，无法批准借阅' }], patches: [{ field: 'status', value: '已批准' }] },
    { id: 'loan-approve-condition', label: '条件批准', collection: 'loans', relation: { collection: 'scrolls', localKey: 'scrollId' }, guards: [{ left: 'related.borrowStatus', op: 'notIn', values: ['不可借阅', '修补中'], message: '经卷当前状态为「不可借阅」或「修补中」，无法条件批准' }], patches: [{ field: 'status', value: '条件批准' }] },
    {
      id: 'loan-out',
      label: '借出',
      collection: 'loans',
      relation: { collection: 'scrolls', localKey: 'scrollId' },
      guards: [
        { left: 'related.borrowStatus', op: 'notIn', values: ['不可借阅', '限制借阅', '修补中'], message: '经卷当前不可借出：状态为不可借阅/限制借阅/修补中' }
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
    { id: 'imaging-reshoot', label: '待重拍', collection: 'imagings', danger: true, patches: [{ field: 'clarity', value: '待重拍' }] },
    { id: 'inventory-normal', label: '正常', collection: 'inventories', patches: [{ field: 'status', value: '正常' }, { field: 'result', value: '正常' }] },
    { id: 'inventory-review', label: '待复核', collection: 'inventories', patches: [{ field: 'status', value: '待复核' }, { field: 'result', value: '异常' }] },
    { id: 'inventory-processed', label: '已处理', collection: 'inventories', patches: [{ field: 'status', value: '已处理' }] },
    { id: 'template-enable', label: '启用', collection: 'repairTemplates', patches: [{ field: 'status', value: '启用' }] },
    { id: 'template-disable', label: '停用', collection: 'repairTemplates', danger: true, patches: [{ field: 'status', value: '停用' }] }
  ],
  loanConditions: {
    '馆内阅览': {
      label: '限馆内阅览',
      icon: '🏛️',
      desc: '仅限在馆内特藏室查阅，不得带出馆外'
    },
    '修补陪同': {
      label: '需修补人员陪同',
      icon: '👥',
      desc: '查阅全过程须由专职修补人员在场陪同监护'
    },
    '禁止拍照': {
      label: '禁止拍照',
      icon: '📵',
      desc: '查阅过程中禁止任何形式的拍照、扫描等影像采集'
    },
    '限定时段': {
      label: '限定时段',
      icon: '⏰',
      desc: '限定在特定时段内查阅，例如工作日上午 9:00-11:00'
    }
  },
  borrowabilityDecision: {
    levels: [
      { value: '可借阅', label: '可借阅', minScore: 0, maxScore: 30, tone: 'ok' },
      { value: '需审批', label: '需审批', minScore: 31, maxScore: 60, tone: 'warn' },
      { value: '限制借阅', label: '限制借阅', minScore: 61, maxScore: 85, tone: 'bad' },
      { value: '不可借阅', label: '不可借阅', minScore: 86, maxScore: 100, tone: 'extreme' }
    ],
    dimensions: {
      protectionLevel: {
        weight: 30,
        label: '保护等级',
        scores: { '一级': 30, '二级': 15, '三级': 5 }
      },
      damage: {
        weight: 25,
        label: '残损描述',
        keywordRules: [
          { keywords: ['虫蛀', '霉斑', '霉变', '脆化', '脆裂', '碳化', '粘连', '空洞', '腐烂'], score: 25, label: '严重残损' },
          { keywords: ['残损', '断裂', '撕裂', '脱落', '缺损', '缺行', '缺页'], score: 18, label: '明显残损' },
          { keywords: ['水渍', '磨损', '褶皱', '脱胶', '卷曲', '受潮', '潮湿', '折痕', '污迹'], score: 12, label: '轻度残损' },
          { keywords: ['轻微', '少量', '边缘', '完好'], score: -5, label: '轻微情况' }
        ]
      },
      lastRepair: {
        weight: 15,
        label: '最近修补状态',
        statusScores: {
          '进行中': 25,
          '计划中': 15,
          '已完成': { within7Days: 8, after7Days: -3 }
        }
      },
      pendingRepairBatches: {
        weight: 15,
        label: '未完成修补批次',
        scorePerBatch: 20
      },
      imagingClarity: {
        weight: 8,
        label: '影像清晰度',
        clarityScores: { '清晰': -5, '模糊': 10, '待重拍': 15 }
      },
      pendingInventory: {
        weight: 12,
        label: '待复核盘点',
        score: 15
      },
      materialWarning: {
        weight: 5,
        label: '材料预警',
        statusScores: { '已过期': 10, '即将到期': 5, '低余量': 3, '正常': 0 }
      },
      futureReservations: {
        weight: 10,
        label: '未来预约',
        overlappingScore: 12,
        within7DaysScore: 8
      }
    },
    blockingRules: [
      {
        id: 'protection-level-1-direct-block',
        condition: (data) => data.scroll?.protectionLevel === '一级' && data.damageScore >= 18,
        result: '不可借阅',
        reason: '一级保护经卷且存在明显/严重残损，禁止借阅',
        suggestion: '推荐使用数字化影像或高仿复制件'
      },
      {
        id: 'active-repair-block',
        condition: (data) => data.hasActiveRepair || data.hasPendingBatch,
        result: '不可借阅',
        reason: '经卷正在修补中或有未完成修补批次',
        suggestion: '待修补完成并静养7日后再评估'
      },
      {
        id: 'pending-inventory-block',
        condition: (data) => data.hasPendingInventory,
        result: '限制借阅',
        reason: '存在待复核的盘点异常',
        suggestion: '先完成盘点复核，确认经卷状态正常'
      },
      {
        id: 'imaging-blur-block',
        condition: (data) => data.latestClarity === '模糊' || data.latestClarity === '待重拍',
        result: '限制借阅',
        reason: '影像清晰度不足，需重新采集',
        suggestion: '先完成高清影像采集存档'
      }
    ],
    suggestionActions: {
      '可借阅': [
        '按正常流程办理借阅登记',
        '查阅时佩戴白手套，轻取轻放',
        '归还时检查有无新增损伤'
      ],
      '需审批': [
        '提交借阅用途说明，由部门负责人审批',
        '查阅时在旁监护，限制翻阅速度',
        '优先使用数字化版本，原件仅供必要核对'
      ],
      '限制借阅': [
        '原则上不提供原件借阅',
        '确需使用须提交专项申请，馆长办公会审议',
        '仅限馆内特藏室查阅，全程专人监护'
      ],
      '不可借阅': [
        '禁止任何形式的原件借阅',
        '推荐使用高清数字化影像或高仿复制件',
        '纳入重点保护名录，加强日常巡检'
      ]
    },
    conservativeMode: {
      enabled: true,
      defaultLevel: '需审批',
      incompleteDataReason: '部分历史数据字段不完整，采用保守评估结论',
      requiredFields: ['protectionLevel', 'damage']
    }
  }
};

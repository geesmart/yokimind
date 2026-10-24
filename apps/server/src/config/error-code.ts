export const ErrorCode = {
  SERVER_ERROR: {
    code: 10000,
    message: 'Server error',
  },
  INVALID_REQUEST: {
    code: 10001,
    message: 'Invalid request',
  },
  FORBIDDEN: {
    code: 10002,
    message: 'Forbidden',
  },
  UNAUTHORIZED: {
    code: 10003,
    message: 'Unauthorized',
  },
  USER_NOT_FOUND: {
    code: 20001,
    message: '用户不存在',
  },
  USER_ALREADY_EXISTS: {
    code: 20002,
    message: 'User already exists',
  },
  INVALID_PASSWORD: {
    code: 20003,
    message: '密码错误',
  },
  // 当前密码校验失败（修改密码场景）
  INVALID_OLD_PASSWORD: {
    code: 20004,
    message: '当前密码错误',
  },
  // 新密码与原密码相同
  SAME_PASSWORD: {
    code: 20005,
    message: '新密码不能与原密码相同',
  },
  // 个人访问令牌不存在或格式非法（智能体接入 PAT）
  PAT_INVALID: {
    code: 21001,
    message: '访问令牌无效',
  },
  // 个人访问令牌已被吊销
  PAT_REVOKED: {
    code: 21002,
    message: '访问令牌已被吊销',
  },
  // 个人访问令牌已过期
  PAT_EXPIRED: {
    code: 21003,
    message: '访问令牌已过期',
  },
  DEVICE_REGISTER_FAILED: {
    code: 30001,
    message: 'Device registration failed',
  },
  DEVICE_NOT_FOUND: {
    code: 30002,
    message: 'Device not found',
  },
  HEARTBEAT_INVALID_DEVICE: {
    code: 31001,
    message: 'Invalid device ID',
  },
  HEARTBEAT_FAILED: {
    code: 31002,
    message: 'Heartbeat failed',
  },
  FEEDBACK_CREATE_FAILED: {
    code: 32001,
    message: 'Failed to create feedback',
  },
  FEEDBACK_INVALID_TYPE: {
    code: 32002,
    message: 'Invalid feedback type',
  },
  VERSION_NOT_FOUND: {
    code: 33001,
    message: 'Version not found',
  },
  AI_SERVICE_ERROR: {
    code: 40001,
    message: 'AI service error',
  },
  AI_RESPONSE_PARSE_ERROR: {
    code: 40002,
    message: 'Failed to parse AI response',
  },
  AI_RATE_LIMIT: {
    code: 40003,
    message: 'AI rate limit exceeded',
  },
  INSUFFICIENT_CREDITS: {
    code: 40004,
    message: 'Insufficient credits',
  },
  // 知识库领域错误 (5xxxx)
  WIKI_NOT_FOUND: {
    code: 50001,
    message: 'Wiki not found',
  },
  WIKI_CREATE_FAILED: {
    code: 50002,
    message: 'Failed to create wiki',
  },
  // 操作动态查询失败
  ACTIVITY_FETCH_FAILED: {
    code: 50003,
    message: 'Failed to fetch activities',
  },
  // 最近访问查询失败
  RECENT_VISIT_FETCH_FAILED: {
    code: 50004,
    message: 'Failed to fetch recent visits',
  },
  // 创建文档节点失败（documents + wikiNodes 事务未完成）
  WIKI_NODE_CREATE_FAILED: {
    code: 50005,
    message: 'Failed to create wiki node',
  },
  // 更新知识库失败
  WIKI_UPDATE_FAILED: {
    code: 50009,
    message: 'Failed to update wiki',
  },
  // 标签不存在 / 未关联该文档（删除未关联标签时返回）
  TAG_NOT_FOUND: {
    code: 50006,
    message: 'Tag not found',
  },
  // 创建标签失败（insert tags 或 document_tags 关联失败）
  TAG_CREATE_FAILED: {
    code: 50007,
    message: 'Failed to create tag',
  },
  // 保存文档失败
  DOCUMENT_SAVE_FAILED: {
    code: 50008,
    message: 'Failed to save document',
  },
  // 乐观锁冲突：文档被其他人/设备并发更新
  DOCUMENT_VERSION_CONFLICT: {
    code: 50009,
    message: 'Document has been modified by others, please refresh',
  },
  // 保存频率超限（rate limit 触发）
  DOCUMENT_SAVE_RATE_LIMITED: {
    code: 50010,
    message: 'Save too frequent, please retry later',
  },
  // 删除文档节点失败
  WIKI_NODE_DELETE_FAILED: {
    code: 50011,
    message: 'Failed to delete wiki node',
  },
  // 删除知识库失败（级联删除 nodes/documents/shares 事务未完成）
  WIKI_DELETE_FAILED: {
    code: 50012,
    message: 'Failed to delete wiki',
  },
  // 节点不在回收站中（对未删除节点执行恢复/彻底删除时返回）
  WIKI_NODE_NOT_IN_TRASH: {
    code: 50013,
    message: 'Node is not in trash',
  },
  // 恢复回收站节点失败（事务未完成或父级调整失败）
  WIKI_NODE_RESTORE_FAILED: {
    code: 50014,
    message: 'Failed to restore wiki node',
  },
  // 知识库不在回收站中（对未软删除的知识库执行彻底删除时返回，防止误清正常库）
  WIKI_NOT_IN_TRASH: {
    code: 50015,
    message: 'Wiki is not in trash',
  },
  // 移动文档节点失败（节点不存在 / 目标父级非法 / 移入自身子树 / 事务未完成）
  WIKI_NODE_MOVE_FAILED: {
    code: 50016,
    message: 'Failed to move wiki node',
  },
  // ============ 媒体资产领域错误 (6xxxx) ============
  // 不支持的图片类型（MIME 不在白名单内）
  MEDIA_INVALID_TYPE: {
    code: 60001,
    message: '不支持的图片类型',
  },
  // 图片大小超出限制
  MEDIA_FILE_TOO_LARGE: {
    code: 60002,
    message: '图片大小超出限制',
  },
  // 图片上传失败（落盘或入库异常）
  MEDIA_UPLOAD_FAILED: {
    code: 60003,
    message: '图片上传失败',
  },
  // 上传请求中未找到文件字段
  MEDIA_FILE_REQUIRED: {
    code: 60004,
    message: '请选择要上传的图片',
  },
  // 媒体资源不存在（按 ID 查询不到）
  MEDIA_NOT_FOUND: {
    code: 60005,
    message: '媒体资源不存在',
  },
  // ============ 知识库分享领域错误 (7xxxx) ============
  // 分享不存在或已关闭（未开启分享 / enabled=false / 配置被删除）
  SHARE_NOT_FOUND: {
    code: 70001,
    message: '分享不存在或已关闭',
  },
  // 该分享设置了访问密码，请求缺少 X-Share-Token 访问令牌
  SHARE_PASSWORD_REQUIRED: {
    code: 70002,
    message: '该分享需要访问密码',
  },
  // 访客输入的密码不正确（bcrypt.compare 未通过）
  SHARE_PASSWORD_INVALID: {
    code: 70003,
    message: '访问密码错误',
  },
  // 访问令牌无效或已过期（HMAC 校验失败 / 超过 12 小时 / wikiId 不匹配）
  SHARE_TOKEN_INVALID: {
    code: 70004,
    message: '访问凭证无效或已过期，请重新输入密码',
  },
  // 分享密码校验过于频繁（防爆破限流触发）
  SHARE_VERIFY_RATE_LIMITED: {
    code: 70005,
    message: '尝试次数过多，请稍后再试',
  },
  // 私密库单页公开时未提供页级访问密码（owner 配置校验：库分享关闭时把单页设为公开，密码必填）
  SHARE_PAGE_PASSWORD_REQUIRED: {
    code: 70006,
    message: '该页面公开需要设置访问密码',
  },
  // 保存分享配置失败（upsert wiki_shares 失败）
  WIKI_SHARE_SAVE_FAILED: {
    code: 70007,
    message: 'Failed to save share config',
  },
  // 知识库分享开启时页面分享被锁定（全部文档跟随库开放，页面分享不可单独修改，需先关闭库分享）
  SHARE_PAGE_LOCKED_BY_WIKI: {
    code: 70008,
    message: '知识库分享开启中，页面分享跟随知识库设置，请先关闭知识库分享',
  },
  // 访客 AI 问答触发限流（公开 LLM 端点防滥用：同 IP 每分钟提问次数超限）
  SHARE_AI_CHAT_RATE_LIMITED: {
    code: 70009,
    message: '提问过于频繁，请稍后再试',
  },
  // 预览令牌无效或已过期（owner 专属预览模式：X-Preview-Token 缺失 / HMAC 校验失败 / 超过 1 小时 / wikiId 不匹配）
  PREVIEW_TOKEN_INVALID: {
    code: 70010,
    message: '预览凭证无效或已过期，请从编辑器重新打开预览',
  },
  // owner 已关闭该库的 AI 助手（访客 ai-chat 接口层守卫，不只是前端 UI 隐藏）
  SHARE_AI_DISABLED: {
    code: 70011,
    message: '该站点未开放 AI 助手',
  },
  // 保存发布配置失败（upsert wiki_publish 失败）
  WIKI_PUBLISH_SAVE_FAILED: {
    code: 70012,
    message: 'Failed to save publish settings',
  },
  // ============ RAG / AI 知识库领域错误 (8xxxx) ============
  // AI 服务未配置（缺少 AI_BASE_URL / AI_API_KEY，worker 与问答接口均不可用）
  RAG_NOT_CONFIGURED: {
    code: 80001,
    message: 'AI 服务未配置，请在管理后台设置 AI 服务商地址与 API Key',
  },
  // 无该知识库访问权限（非 owner / 非协作者）
  RAG_WIKI_FORBIDDEN: {
    code: 80002,
    message: '无权访问该知识库',
  },
  // 查询/提问内容为空
  RAG_QUERY_REQUIRED: {
    code: 80003,
    message: '查询内容不能为空',
  },
  // Embedding 调用失败（网络异常 / 服务商报错）
  RAG_EMBEDDING_FAILED: {
    code: 80004,
    message: '向量化失败，请稍后重试',
  },
  // AI 问答调用失败（网络异常 / 服务商报错）
  RAG_CHAT_FAILED: {
    code: 80005,
    message: 'AI 问答失败，请稍后重试',
  },
  // Embedding 返回维度与配置/数据库列维度不符（多为换模型未重建索引）
  RAG_EMBEDDING_DIM_MISMATCH: {
    code: 80006,
    message: '向量维度与配置不符，请检查 AI_EMBEDDING_DIM 或重建索引',
  },
  // 重建索引失败（reindex 事务异常）
  RAG_REINDEX_FAILED: {
    code: 80007,
    message: '重建索引失败，请稍后重试',
  },
  NOT_FOUND: {
    code: 40400,
    message: 'Resource not found',
  },
  // ============ 管理后台领域错误 (9xxxx) ============
  // 非管理员访问 admin 接口（admins 白名单表未命中）
  ADMIN_FORBIDDEN: {
    code: 90001,
    message: '无管理员权限',
  },
  // AI 连接测试失败（test-ai 接口通常以 ok:false 正常返回，此码备用）
  AI_TEST_FAILED: {
    code: 90002,
    message: 'AI 连接测试失败',
  },
}

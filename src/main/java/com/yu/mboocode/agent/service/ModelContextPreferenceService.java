package com.yu.mboocode.agent.service;

import com.yu.mboocode.agent.dto.ModelContextLimitResp;
import com.yu.mboocode.agent.mapper.ModelContextPreferenceMapper;
import com.yu.mboocode.agent.model.ModelContextPreference;
import com.yu.mboocode.agent.model.ModelInfo;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.common.util.DateTimeUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 统一解析模型能力上限、用户偏好和实际生效上下文上限。
 */
@Service
@Slf4j
public class ModelContextPreferenceService {
    public static final long MINIMUM_CONTEXT_LIMIT = 100_000L;

    @Resource
    private ModelContextPreferenceMapper modelContextPreferenceMapper;
    @Resource
    private ModelOptionService modelOptionService;

    public ModelContextLimitResp getContextLimit(String modelId) {
        return getContextLimit(modelOptionService.requireModelInfo(modelId));
    }

    public ModelContextLimitResp getContextLimit(ModelInfo modelInfo) {
        ModelContextPreference preference = modelContextPreferenceMapper.selectById(modelInfo.modelId());
        return buildResponse(modelInfo, preference == null ? null : preference.getContextLimit());
    }

    /**
     * 预算主流程在偏好表异常时回退模型能力上限，不能让辅助配置读取中断聊天。
     */
    public long getEffectiveContextLimit(ModelInfo modelInfo) {
        try {
            return getContextLimit(modelInfo).effectiveContextLimit();
        } catch (Exception e) {
            long maximum = requireMaximumContextLimit(modelInfo);
            log.error("读取模型上下文偏好失败，回退 models.dev 上限 modelId:{} contextLimit:{}", modelInfo.modelId(), maximum, e);
            return maximum;
        }
    }

    public ModelContextLimitResp saveContextLimit(String modelId, Long contextLimit) {
        ModelInfo modelInfo = modelOptionService.requireModelInfo(modelId);
        long maximum = requireMaximumContextLimit(modelInfo);
        if (maximum <= MINIMUM_CONTEXT_LIMIT) throw new ServiceException("当前模型的上下文上限没有可调范围");
        if (contextLimit == null) throw new ServiceException("上下文上限不能为空");
        if (contextLimit < MINIMUM_CONTEXT_LIMIT) throw new ServiceException("上下文上限不能低于 100.0K");
        if (contextLimit > maximum) throw new ServiceException("上下文上限不能超过模型能力上限");
        if (contextLimit == maximum) return resetContextLimit(modelInfo.modelId());

        String now = DateTimeUtil.now();
        ModelContextPreference preference = new ModelContextPreference();
        preference.setModelId(modelInfo.modelId());
        preference.setContextLimit(contextLimit);
        preference.setCreatedAt(now);
        preference.setUpdatedAt(now);
        modelContextPreferenceMapper.upsert(preference);
        return getContextLimit(modelInfo);
    }

    public ModelContextLimitResp resetContextLimit(String modelId) {
        ModelInfo modelInfo = modelOptionService.requireModelInfo(modelId);
        modelContextPreferenceMapper.deleteById(modelInfo.modelId());
        return buildResponse(modelInfo, null);
    }

    private ModelContextLimitResp buildResponse(ModelInfo modelInfo, Long configuredContextLimit) {
        long maximum = requireMaximumContextLimit(modelInfo);
        long minimum = Math.min(MINIMUM_CONTEXT_LIMIT, maximum);
        long effective = configuredContextLimit == null ? maximum : Math.max(minimum, Math.min(configuredContextLimit, maximum));
        return new ModelContextLimitResp(modelInfo.modelId(), minimum, maximum, configuredContextLimit, effective, maximum > minimum);
    }

    private long requireMaximumContextLimit(ModelInfo modelInfo) {
        Long maximum = modelInfo.limit() == null ? null : modelInfo.limit().context();
        if (maximum == null || maximum <= 0) throw new ServiceException("模型不存在或未提供能力信息");
        return maximum;
    }
}

package com.yu.mboocode.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yu.mboocode.agent.model.ModelContextPreference;
import org.apache.ibatis.annotations.Insert;

public interface ModelContextPreferenceMapper extends BaseMapper<ModelContextPreference> {
    @Insert("""
            INSERT INTO mboo_model_context_preference(model_id, context_limit, created_at, updated_at)
            VALUES(#{modelId}, #{contextLimit}, #{createdAt}, #{updatedAt})
            ON CONFLICT(model_id) DO UPDATE SET context_limit = excluded.context_limit, updated_at = excluded.updated_at
            """)
    void upsert(ModelContextPreference preference);
}

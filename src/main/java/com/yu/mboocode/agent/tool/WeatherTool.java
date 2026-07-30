package com.yu.mboocode.agent.tool;

import cn.hutool.core.util.StrUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.agent.tool.permission.ToolPermission;
import com.yu.mboocode.agent.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;

@Component
public class WeatherTool {
    private static final int REQUEST_TIMEOUT = 5000;
    private static final String GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
    private static final String FORECAST_API = "https://api.open-meteo.com/v1/forecast";
    private static final String CURRENT_FIELDS = "temperature_2m,relative_humidity_2m,apparent_temperature,"
            + "precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m";

    @Tool("根据明确的城市名称查询当前实时天气。仅当用户已提供城市时调用；未提供城市时先追问城市。")
    @ToolPermission(
            value = ToolPermissionType.TOOL,
            title = "允许查询天气？",
            description = "天气工具将访问网络，根据城市名称查询实时天气。"
    )
    public String getWeather(@P(name = "city", value = "城市名称，例如：北京、上海、杭州") String city) {
        String cityName = StrUtil.trim(city);
        if (StrUtil.isBlank(cityName)) {
            return "请提供要查询天气的城市名称。";
        }

        try {
            JSONObject location = getLocation(cityName);
            if (location == null) {
                return "未查询到城市：" + cityName + "，请检查城市名称。";
            }

            JSONObject current = getCurrentWeather(location);
            return buildWeatherResult(location, cityName, current);
        } catch (ServiceException e) {
            throw e;
        } catch (Exception e) {
            throw new ServiceException("查询天气失败，请稍后再试");
        }
    }

    private JSONObject getLocation(String cityName) {
        String url = GEOCODING_API
                + "?name=" + URLEncoder.encode(cityName, StandardCharsets.UTF_8)
                + "&count=1&language=zh&format=json";
        JSONObject json = JSON.parseObject(get(url));
        JSONArray results = json.getJSONArray("results");
        if (results == null || results.isEmpty()) {
            return null;
        }
        return results.getJSONObject(0);
    }

    private JSONObject getCurrentWeather(JSONObject location) {
        Double latitude = location.getDouble("latitude");
        Double longitude = location.getDouble("longitude");
        if (latitude == null || longitude == null) {
            throw new ServiceException("查询天气失败，请稍后再试");
        }

        String url = FORECAST_API
                + "?latitude=" + latitude
                + "&longitude=" + longitude
                + "&current=" + CURRENT_FIELDS
                + "&timezone=auto&forecast_days=1";
        JSONObject json = JSON.parseObject(get(url));
        JSONObject current = json.getJSONObject("current");
        if (current == null) {
            throw new ServiceException("查询天气失败，请稍后再试");
        }
        return current;
    }

    private String get(String url) {
        try (HttpResponse response = HttpRequest.get(url)
                .header("Accept-Encoding", "identity")
                .timeout(REQUEST_TIMEOUT)
                .execute()) {
            if (!response.isOk() || StrUtil.isBlank(response.body())) {
                throw new ServiceException("查询天气失败，请稍后再试");
            }
            return response.body();
        }
    }

    private String buildWeatherResult(JSONObject location, String fallbackCity, JSONObject current) {
        String weather = describeWeather(current.getInteger("weather_code"));
        String cityName = buildCityName(location, fallbackCity);
        return String.join("\n",
                cityName + "当前天气：",
                "更新时间：" + valueOrUnknown(current.getString("time")),
                "天气：" + weather,
                "温度：" + formatValue(current.get("temperature_2m")) + "摄氏度",
                "体感温度：" + formatValue(current.get("apparent_temperature")) + "摄氏度",
                "湿度：" + formatValue(current.get("relative_humidity_2m")) + "%",
                "降水：" + formatValue(current.get("precipitation")) + "毫米",
                "云量：" + formatValue(current.get("cloud_cover")) + "%",
                "风速：" + formatValue(current.get("wind_speed_10m")) + "公里/小时",
                "风向：" + formatWindDirection(current.getDouble("wind_direction_10m")));
    }

    private String buildCityName(JSONObject location, String fallbackCity) {
        String name = StrUtil.blankToDefault(location.getString("name"), fallbackCity);
        String admin1 = location.getString("admin1");
        String country = location.getString("country");

        StringBuilder cityName = new StringBuilder(name);
        if (StrUtil.isNotBlank(admin1) && !StrUtil.equals(name, admin1)) {
            cityName.append("，").append(admin1);
        }
        if (StrUtil.isNotBlank(country)) {
            cityName.append("，").append(country);
        }
        return cityName.toString();
    }

    private String formatValue(Object value) {
        if (value == null) {
            return "暂无";
        }
        if (value instanceof Number) {
            return new BigDecimal(value.toString()).stripTrailingZeros().toPlainString();
        }
        return valueOrUnknown(value.toString());
    }

    private String valueOrUnknown(String value) {
        return StrUtil.blankToDefault(value, "暂无");
    }

    private String formatWindDirection(Double degree) {
        if (degree == null) {
            return "暂无";
        }
        String[] directions = {"北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"};
        int index = (int) Math.floor((degree + 22.5) / 45) % directions.length;
        return formatValue(degree) + "度（" + directions[index] + "）";
    }

    private String describeWeather(Integer code) {
        if (code == null) {
            return "未知";
        }
        return switch (code) {
            case 0 -> "晴";
            case 1 -> "基本晴朗";
            case 2 -> "局部多云";
            case 3 -> "阴";
            case 45, 48 -> "雾";
            case 51, 53, 55 -> "毛毛雨";
            case 56, 57 -> "冻毛毛雨";
            case 61, 63, 65 -> "雨";
            case 66, 67 -> "冻雨";
            case 71, 73, 75 -> "雪";
            case 77 -> "雪粒";
            case 80, 81, 82 -> "阵雨";
            case 85, 86 -> "阵雪";
            case 95 -> "雷暴";
            case 96, 99 -> "雷暴伴冰雹";
            default -> "未知天气（代码：" + code + "）";
        };
    }
}

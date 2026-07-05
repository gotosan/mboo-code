package com.yu.mboocode.common.handler;

import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.common.dto.R;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.support.DefaultMessageSourceResolvable;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 全局Controller异常捕捉器，注意：捕获异常的优先级会按方法定义的顺序来捕获
 */
@ControllerAdvice
@ResponseBody
@Slf4j
public class GlobalExceptionHandler {
    //校验异常
    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    public ResponseEntity<R<Void>> validExceptionHandler(Exception ex) {
        String msg;
        if (ex instanceof MethodArgumentNotValidException) {
            msg = ((MethodArgumentNotValidException) ex).getBindingResult().getFieldErrors().stream().map(DefaultMessageSourceResolvable::getDefaultMessage).collect(Collectors.joining(";"));
        } else if (ex instanceof BindException) {
            msg = ((BindException) ex).getBindingResult().getFieldErrors().stream().map(DefaultMessageSourceResolvable::getDefaultMessage).collect(Collectors.joining(";"));
        } else {
            msg = ex.getMessage();
        }
        return failedResponse(HttpStatus.BAD_REQUEST, R.failed(msg));
    }

    //controller数据绑定异常
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<R<Void>> fieldExceptionHandler(HttpMessageNotReadableException ex) {
        String msg;
        Throwable cause = ex.getCause();
        if (cause instanceof InvalidFormatException e) {
            msg = "字段'" + e.getPath().getLast().getFieldName() + "'类型错误，应为" + e.getTargetType().getSimpleName() + "类型";
        } else if (cause != null && cause.getCause() != null) {
            msg = cause.getCause().getMessage();
        } else if (cause != null) {
            msg = cause.getMessage();
        } else {
            msg = ex.getMessage();
        }
        return failedResponse(HttpStatus.BAD_REQUEST, R.failed(msg));
    }

    private static final Pattern FIELD_PATTERN = Pattern.compile("'(.*?)'");

    //业务异常
    @ExceptionHandler(ServiceException.class)
    public ResponseEntity<R<Void>> serviceExceptionHandler(Exception e) {
        return failedResponse(HttpStatus.BAD_REQUEST, R.failed(e.getMessage()));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<R<Void>> missingServletRequestParameterExceptionHandler(Exception e) {
        String field = "";
        String str = e.getMessage();
        Matcher matcher = FIELD_PATTERN.matcher(str);
        if (matcher.find()) {
            field = matcher.group(1);  // 用 group(1) 去掉引号
        }
        return failedResponse(HttpStatus.BAD_REQUEST, R.failed(String.format("字段 %s 不可为空", field)));
    }

    //其他未捕获的异常
    @ExceptionHandler(Exception.class)
    public ResponseEntity<R<Void>> otherExceptionHandler(Exception ex) {
        log.error(ex.getMessage(), ex);
        return failedResponse(HttpStatus.INTERNAL_SERVER_ERROR, R.failed("服务器内部错误，请联系管理员", ex.getMessage()));
    }

    private ResponseEntity<R<Void>> failedResponse(HttpStatus status, R<Void> body) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body);
    }
}

use crate::{TranspileOptions, transpile, version};
use jni::JNIEnv;
use jni::objects::{JObject, JString};
use jni::sys::jstring;

fn jstring_to_string(env: &mut JNIEnv, input: JString) -> Option<String> {
    match env.get_string(&input) {
        Ok(jni_str) => jni_str.to_str().ok().map(|s| s.to_string()),
        Err(_) => None,
    }
}

fn new_jstring(env: &mut JNIEnv, value: &str) -> jstring {
    match env.new_string(value) {
        Ok(jstr) => jstr.into_raw(),
        Err(_) => env.new_string("").unwrap().into_raw(),
    }
}

/// JNI bridge exposed to React Native (via RustTranspilerModule)
#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_RustTranspilerModule_nativeTranspile(
    mut env: JNIEnv,
    _this: JObject,
    code: JString,
    filename: JString,
) -> jstring {
    let source = match jstring_to_string(&mut env, code) {
        Some(val) => val,
        None => {
            let _ = env.throw_new(
                "java/lang/IllegalArgumentException",
                "code was null or malformed",
            );
            return new_jstring(&mut env, "");
        }
    };

    let file = jstring_to_string(&mut env, filename).unwrap_or_else(|| "module.tsx".to_string());

    let opts = TranspileOptions {
        filename: Some(file.clone()),
        react_dev: false,
        to_commonjs: true,
        pragma: Some("h".into()),
        pragma_frag: None,
    };

    match transpile(&source, opts) {
        Ok(output) => new_jstring(&mut env, &output.code),
        Err(err) => {
            let _ = env.throw_new("java/lang/RuntimeException", err.to_string());
            new_jstring(&mut env, "")
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Java_com_relay_client_RustTranspilerModule_nativeGetVersion(
    mut env: JNIEnv,
    _this: JObject,
) -> jstring {
    new_jstring(&mut env, version())
}

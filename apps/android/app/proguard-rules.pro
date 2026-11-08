# WebRTC uses JNI; keep its Java surface intact if minification is enabled.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

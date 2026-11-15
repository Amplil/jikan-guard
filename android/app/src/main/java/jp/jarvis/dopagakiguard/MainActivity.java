package jp.jarvis.dopagakiguard;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.graphics.Color;
import android.os.*;
import android.provider.Settings;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;
public final class MainActivity extends Activity {
 private TextView status,permissions; private EditText minutes; private LinearLayout apps;
 private final ExecutorService worker=Executors.newSingleThreadExecutor();private int revision=0;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private final Runnable refresh=new Runnable(){public void run(){update();handler.postDelayed(this,10000);}};
 private int dp(int x){return (int)(x*getResources().getDisplayMetrics().density);}
 private TextView label(String s,int size){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(Color.rgb(32,33,57));t.setPadding(0,dp(8),0,dp(8));return t;}
 private void button(LinearLayout box,String title,Runnable action){Button b=new Button(this);b.setText(title);box.addView(b);b.setOnClickListener(v->action.run());}
 @Override public void onCreate(Bundle b){super.onCreate(b);
  ScrollView scroll=new ScrollView(this);LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(dp(24),dp(20),dp(24),dp(32));box.setBackgroundColor(Color.rgb(246,244,251));scroll.addView(box);setContentView(scroll);
  box.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+i.left,dp(20)+i.top,dp(24)+i.right,dp(32)+i.bottom);return insets;});
  TextView tagline=label("ドパガキに待ったを",12);tagline.setTextColor(Color.rgb(101,101,123));tagline.setPadding(0,0,0,0);box.addView(tagline);
  TextView title=label("ドパガキガード",26);title.setPadding(0,0,0,dp(8));box.addView(title);
  status=label("確認中…",24);box.addView(status);
  box.addView(label("選んだアプリを合計して、毎日0時に区切ります。動画だけでなく、アプリが手前にある時間の推定です。",15));
  box.addView(label("これは利用状況・お知らせの試作版です。他のアプリをブロックしません。OSの記録や分割画面などにより誤差があります。",15));
  permissions=label("",14);box.addView(permissions);
  button(box,"利用状況へのアクセスを設定",()->{new AlertDialog.Builder(this).setTitle("端末内だけで集計します")
   .setMessage("Androidの利用履歴へのアクセスが必要です。次の設定画面で、このアプリだけを自分で許可してください。履歴を外部へ送信しません。")
   .setNegativeButton("戻る",null).setPositiveButton("設定を開く",(d,w)->{try{startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));}catch(ActivityNotFoundException e){Toast.makeText(this,"この端末では設定画面を開けません",Toast.LENGTH_LONG).show();}}).show();});
  box.addView(label("1日の共通の目安（分）",18));minutes=new EditText(this);minutes.setInputType(InputType.TYPE_CLASS_NUMBER);minutes.setText(""+Usage.prefs(this).getInt("minutes",30));minutes.setContentDescription("1日合計の目安、1分から1440分");box.addView(minutes);
  button(box,"目安を保存",()->{try{int m=Integer.parseInt(minutes.getText().toString());if(m<1||m>1440)throw new NumberFormatException();Usage.prefs(this).edit().putInt("minutes",m).apply();update();Toast.makeText(this,"保存しました",Toast.LENGTH_SHORT).show();}catch(NumberFormatException e){minutes.setError("1〜1440分を入力してください");}});
  Switch notify=new Switch(this);notify.setText("目安に達したら通知する");notify.setChecked(Usage.prefs(this).getBoolean("notify",false));box.addView(notify);
  box.addView(label("通知は約15分以上の間隔で確認し、OSにより遅延・停止します。リアルタイムではありません。再起動後はこのアプリを開くと再開。1日1回まで。",14));
  notify.setOnCheckedChangeListener((v,on)->{Usage.prefs(this).edit().putBoolean("notify",on).apply();if(on&&Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},11);int result=CheckJob.schedule(this);if(result!=android.app.job.JobScheduler.RESULT_SUCCESS)Toast.makeText(this,"定期確認を登録できませんでした。アプリ内の確認は使えます",Toast.LENGTH_LONG).show();update();});
  button(box,"今すぐ確認",this::update);button(box,"通知のシステム設定",()->startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName())));
  box.addView(label("合計するアプリ",20));apps=new LinearLayout(this);apps.setOrientation(1);box.addView(apps);loadApps();
  button(box,"選択をすべて解除",()->{Usage.prefs(this).edit().putStringSet("selected",new HashSet<>()).apply();loadApps();update();});
  box.addView(label("設定と選択は端末内のみ。通信・広告・アカウントはありません。利用履歴そのものは保存せず、Androidの履歴から計算します。",14));
 }
 private void loadApps(){apps.removeAllViews();Set<String> selected=Usage.selected(this);Intent intent=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
  List<ResolveInfo> list=getPackageManager().queryIntentActivities(intent,0);list.sort(Comparator.comparing(r->r.loadLabel(getPackageManager()).toString()));Set<String> seen=new HashSet<>();
  for(ResolveInfo r:list){String pkg=r.activityInfo.packageName;if(pkg.equals(getPackageName())||!seen.add(pkg))continue;CheckBox cb=new CheckBox(this);cb.setText(r.loadLabel(getPackageManager())+"\n"+pkg);cb.setChecked(selected.contains(pkg));apps.addView(cb);cb.setOnCheckedChangeListener((v,on)->{Set<String> s=Usage.selected(this);if(on)s.add(pkg);else s.remove(pkg);Usage.prefs(this).edit().putStringSet("selected",s).apply();update();});}
  if(seen.isEmpty())apps.addView(label("選択できるアプリがありません",16));
 }
 private void update(){int version=++revision;permissions.setText("利用状況: "+(Usage.allowed(this)?"許可あり":"未許可（0分とは判定しません）")+"　通知: "+(CheckJob.notificationsAllowed(this)?"許可あり":"未許可 / 無効"));
  worker.submit(()->{Usage.Snapshot s=null;try{s=Usage.read(this);}catch(SecurityException ignored){}final Usage.Snapshot data=s;runOnUiThread(()->{if(isDestroyed()||version!=revision)return;
   if(data==null){status.setText("利用状況を確認できません");return;}if(Usage.selected(this).isEmpty()){status.setText("まず対象アプリを選択");return;}
   long cap=Usage.prefs(this).getInt("minutes",30)*60000L,remaining=Budget.remaining(data.used,cap);
   status.setText(data.day+"\n今日の合計 "+(data.used/60000)+"分 "+((data.used/1000)%60)+"秒\n"+(remaining==0?"目安に達しました。ひと休みしましょう":"あと "+((remaining+59999)/60000)+"分（目安）"));CheckJob.check(this,data);
  });});
 }
 @Override protected void onResume(){super.onResume();CheckJob.schedule(this);handler.post(refresh);}
 @Override protected void onPause(){handler.removeCallbacks(refresh);super.onPause();}
 @Override protected void onDestroy(){handler.removeCallbacks(refresh);worker.shutdownNow();super.onDestroy();}
}

package jp.jarvis.dopagakiguard;
import android.app.*;
import android.app.job.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
public final class CheckJob extends JobService {
 static final int JOB=301,NOTE=302;static final String CHANNEL="daily-limit";
 static boolean notificationsAllowed(Context c){
  NotificationManager n=c.getSystemService(NotificationManager.class);
  NotificationChannel ch=n.getNotificationChannel(CHANNEL);
  return (Build.VERSION.SDK_INT<33||c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)&&n.areNotificationsEnabled()&&(ch==null||ch.getImportance()!=NotificationManager.IMPORTANCE_NONE);
 }
 static int schedule(Context c){
  JobScheduler j=c.getSystemService(JobScheduler.class);
  if(!Usage.prefs(c).getBoolean("notify",false)){j.cancel(JOB);c.getSystemService(NotificationManager.class).cancel(NOTE);return JobScheduler.RESULT_SUCCESS;}
  if(j.getPendingJob(JOB)!=null)return JobScheduler.RESULT_SUCCESS;
  return j.schedule(new JobInfo.Builder(JOB,new ComponentName(c,CheckJob.class)).setPeriodic(15*60*1000L).build());
 }
 static synchronized void check(Context c,Usage.Snapshot s){
  if(s==null||!Usage.prefs(c).getBoolean("notify",false)||!notificationsAllowed(c))return;
  long cap=Usage.prefs(c).getInt("minutes",30)*60000L;
  if(s.used<cap){c.getSystemService(NotificationManager.class).cancel(NOTE);return;}
  if(!Budget.shouldNotify(s.used,cap,s.day,Usage.prefs(c).getString("notified","")))return;
  NotificationManager n=c.getSystemService(NotificationManager.class);
  n.createNotificationChannel(new NotificationChannel(CHANNEL,"1日の目安のお知らせ",NotificationManager.IMPORTANCE_DEFAULT));
  PendingIntent pi=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  n.notify(NOTE,new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("今日はひと休みしませんか")
   .setContentText("選んだアプリの合計が1日の目安に達しました。アプリの強制停止は行いません。")
   .setContentIntent(pi).setOnlyAlertOnce(true).setAutoCancel(true).build());
  Usage.prefs(c).edit().putString("notified",s.day).apply();
 }
 @Override public boolean onStartJob(JobParameters p){
  new Thread(()->{try{check(this,Usage.read(this));}catch(SecurityException ignored){}finally{jobFinished(p,false);}},"usage-check").start();return true;
 }
 @Override public boolean onStopJob(JobParameters p){return false;}
}

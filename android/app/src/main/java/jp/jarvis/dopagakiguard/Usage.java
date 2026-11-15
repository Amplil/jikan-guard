package jp.jarvis.dopagakiguard;
import android.app.AppOpsManager;
import android.app.usage.*;
import android.content.*;
import android.os.Process;
import android.os.UserManager;
import java.time.ZoneId;
import java.util.*;
final class Usage {
 static SharedPreferences prefs(Context c){return c.getSharedPreferences("guard",Context.MODE_PRIVATE);}
 static Set<String> selected(Context c){return new HashSet<>(prefs(c).getStringSet("selected",Collections.emptySet()));}
 static boolean allowed(Context c){return c.getSystemService(AppOpsManager.class).unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,Process.myUid(),c.getPackageName())==AppOpsManager.MODE_ALLOWED;}
 static final class Snapshot {final long used;final String day; Snapshot(long u,String d){used=u;day=d;}}
 static Snapshot read(Context c){
  if(!allowed(c)||!c.getSystemService(UserManager.class).isUserUnlocked())return null;
  long now=System.currentTimeMillis(),start=Budget.midnight(now,ZoneId.systemDefault());
  // One-day lookback seeds a session crossing midnight. Missing OS events can undercount.
  UsageEvents stream=c.getSystemService(UsageStatsManager.class).queryEvents(start-86400000L,now);
  if(stream==null)return null;
  List<Budget.Event> events=new ArrayList<>();UsageEvents.Event e=new UsageEvents.Event();
  while(stream.hasNextEvent()){
   stream.getNextEvent(e);int k=0,t=e.getEventType();
   if(t==UsageEvents.Event.ACTIVITY_RESUMED)k=Budget.RESUME;
   else if(t==UsageEvents.Event.ACTIVITY_PAUSED)k=Budget.PAUSE;
   else if(t==UsageEvents.Event.SCREEN_NON_INTERACTIVE||t==UsageEvents.Event.DEVICE_SHUTDOWN||t==UsageEvents.Event.DEVICE_STARTUP)k=Budget.CLEAR;
   // The public SDK exposes class names, not per-instance IDs.
   if(k!=0)events.add(new Budget.Event(e.getTimeStamp(),e.getPackageName(),k,e.getPackageName()+":"+e.getClassName()));
  }
  return new Snapshot(Budget.total(events,selected(c),start,now),Budget.day(now,ZoneId.systemDefault()));
 }
}

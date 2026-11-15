import jp.jarvis.dopagakiguard.Budget;
import java.time.*;
import java.util.*;
public class BudgetTest {
 static int count;static void eq(long a,long b){count++;if(a!=b)throw new AssertionError(a+" != "+b);}
 static Budget.Event e(long t,String p,int k){return new Budget.Event(t,p,k);}
 static long sum(Budget.Event... e){return Budget.total(Arrays.asList(e),Set.of("a","b"),100,1000);}
 public static void main(String[] args){
  eq(sum(),0);eq(sum(e(100,"a",1),e(300,"a",2),e(400,"b",1),e(700,"b",2)),500);
  eq(sum(e(50,"a",1),e(200,"a",2)),100);
  eq(sum(e(100,"a",1),e(200,"a",1),e(400,"a",2)),300);
  eq(sum(e(100,"a",1),e(200,"b",1),e(300,"a",2),e(400,"b",2)),300);
  eq(sum(e(100,"a",1),e(200,"a",2),e(200,"c",1)),100);
  eq(sum(e(100,"a",1),e(300,"b",1),e(500,"a",2),e(700,"b",2)),600);
  eq(sum(e(100,"a",1),e(200,null,3)),100);
  eq(sum(e(800,"a",1)),200);eq(sum(e(1200,"a",1)),0);
  eq(Budget.remaining(200,100),0);eq(Budget.remaining(10,100),90);
  eq(Budget.shouldNotify(30,30,"today","")?1:0,1);eq(Budget.shouldNotify(30,30,"today","today")?1:0,0);
  eq(Budget.shouldNotify(29,30,"today","")?1:0,0);
  ZoneId tokyo=ZoneId.of("Asia/Tokyo");long now=Instant.parse("2026-11-15T01:00:00Z").toEpochMilli();
  eq(Budget.midnight(now,tokyo),Instant.parse("2026-11-14T15:00:00Z").toEpochMilli());
  ZoneId ny=ZoneId.of("America/New_York");long dst=Instant.parse("2026-03-08T16:00:00Z").toEpochMilli();
  eq(Budget.midnight(dst,ny),Instant.parse("2026-03-08T05:00:00Z").toEpochMilli());
  eq(Budget.total(List.of(e(100,"a",1)),Set.of("a"),100,100),0);
  // Public SDK identity: multiple classes in one package can overlap without double-counting.
  eq(sum(new Budget.Event(100,"a",1,"a:One"),new Budget.Event(200,"a",1,"a:Two"),
         new Budget.Event(300,"a",2,"a:One"),new Budget.Event(500,"a",2,"a:Two")),400);
  eq(sum(new Budget.Event(100,"a",1,"a:One"),new Budget.Event(250,"a",2,"a:Unknown")),900);
  eq(sum(new Budget.Event(100,"a",1,"a:One"),new Budget.Event(200,"a",1,"a:Two"),
         e(350,null,3)),250);
  System.out.println("PASS "+count+" assertions (pure Java only, not Android device tests)");
 }
}

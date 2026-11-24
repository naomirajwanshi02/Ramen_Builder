# Cuts the painted ramen bowl out of its white background (and its grey shadow) for the intro card.
# Edges stay smooth: the mask is made at full size, pulled in 2 px so no white halo is left,
# softened, and the picture is then scaled down with high-quality filtering.
#   powershell -ExecutionPolicy Bypass -File tools/make-cutout.ps1
param([string]$Src = "$PSScriptRoot\..\assets\ramen-painting.jpg", [string]$Out = "$PSScriptRoot\..\assets\bowl-cutout.png", [int]$Width = 720)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Cutout {
  public static string Run(string srcPath, string outPath, int outW){
    using (var src = new Bitmap(srcPath)){
      int w = src.Width, h = src.Height;
      var rect = new Rectangle(0, 0, w, h);
      using (var bmp = src.Clone(rect, PixelFormat.Format32bppArgb)){
        var d = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        var px = new byte[w * h * 4]; Marshal.Copy(d.Scan0, px, 0, px.Length);
        // background: white or the grey shadow, i.e. light and colourless; the bowl is cream (warm)
        var cand = new bool[w * h];
        for (int i = 0; i < w * h; i++){
          int b = px[i*4], g = px[i*4+1], r = px[i*4+2];
          int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
          cand[i] = mn > 196 && (mx - mn) < 22;
        }
        // flood fill from the border, so pale spots inside the bowl stay
        var bg = new bool[w * h]; var q = new Queue<int>();
        for (int x = 0; x < w; x++){ Seed(x, cand, bg, q); Seed((h-1)*w + x, cand, bg, q); }
        for (int y = 0; y < h; y++){ Seed(y*w, cand, bg, q); Seed(y*w + w-1, cand, bg, q); }
        while (q.Count > 0){
          int i = q.Dequeue(), x = i % w, y = i / w;
          if (x > 0) Seed(i-1, cand, bg, q); if (x < w-1) Seed(i+1, cand, bg, q);
          if (y > 0) Seed(i-w, cand, bg, q); if (y < h-1) Seed(i+w, cand, bg, q);
        }
        var a = new float[w * h];
        for (int i = 0; i < w * h; i++) a[i] = bg[i] ? 0f : 1f;
        a = Erode(a, w, h, 2);
        a = Blur(a, w, h, 2); a = Blur(a, w, h, 2);
        int minX = w, minY = h, maxX = 0, maxY = 0;
        for (int i = 0; i < w * h; i++){
          float v = Math.Max(0f, Math.Min(1f, (a[i] - 0.5f) * 1.6f + 0.5f));
          px[i*4+3] = (byte)Math.Round(v * 255);
          if (v > 0.03f){ int x = i % w, y = i / w; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
        Marshal.Copy(px, 0, d.Scan0, px.Length); bmp.UnlockBits(d);
        int pad = 6; minX = Math.Max(0, minX-pad); minY = Math.Max(0, minY-pad); maxX = Math.Min(w-1, maxX+pad); maxY = Math.Min(h-1, maxY+pad);
        int cw = maxX-minX+1, ch = maxY-minY+1, outH = (int)Math.Round((double)outW * ch / cw);
        using (var o = new Bitmap(outW, outH, PixelFormat.Format32bppPArgb)){
          using (var g = Graphics.FromImage(o)){
            g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality; g.CompositingMode = CompositingMode.SourceCopy;
            using (var ia = new ImageAttributes()){ ia.SetWrapMode(WrapMode.TileFlipXY);
              g.DrawImage(bmp, new Rectangle(0, 0, outW, outH), minX, minY, cw, ch, GraphicsUnit.Pixel, ia); }
          }
          using (var fin = o.Clone(new Rectangle(0, 0, outW, outH), PixelFormat.Format32bppArgb)) fin.Save(outPath, ImageFormat.Png);
        }
        return outW + "x" + outH;
      }
    }
  }
  static void Seed(int i, bool[] cand, bool[] bg, Queue<int> q){ if (cand[i] && !bg[i]){ bg[i] = true; q.Enqueue(i); } }
  static float[] Erode(float[] a, int w, int h, int r){
    var o = new float[a.Length];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++){
      float m = 1f;
      for (int dy = -r; dy <= r; dy++) for (int dx = -r; dx <= r; dx++){
        if (dx*dx + dy*dy > r*r) continue;
        int xx = x+dx, yy = y+dy;
        float v = (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0f : a[yy*w+xx];
        if (v < m) m = v;
      }
      o[y*w+x] = m;
    }
    return o;
  }
  static float[] Blur(float[] a, int w, int h, int r){
    var t = new float[a.Length]; var o = new float[a.Length]; float n = 2*r+1;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++){ float s = 0; for (int k = -r; k <= r; k++){ int xx = Math.Max(0, Math.Min(w-1, x+k)); s += a[y*w+xx]; } t[y*w+x] = s/n; }
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++){ float s = 0; for (int k = -r; k <= r; k++){ int yy = Math.Max(0, Math.Min(h-1, y+k)); s += t[yy*w+x]; } o[y*w+x] = s/n; }
    return o;
  }
}
'@
$size = [Cutout]::Run([IO.Path]::GetFullPath($Src), [IO.Path]::GetFullPath($Out), $Width)
"saved $Out ($size)"
